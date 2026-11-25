"""Pack the Chongli prototype, including script-free views, as a single offline HTML file."""

import argparse
import base64
import html
from html.parser import HTMLParser
import mimetypes
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ATTR = re.compile(r'''(?P<space>\s+)(?P<name>[^\s=/>]+)\s*=\s*(?:"(?P<double>[^"]*)"|'(?P<single>[^']*)'|(?P<bare>[^\s>]+))''')
CSS_URL = re.compile(r'''url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)''', re.I)
SCRIPT_ASSET = re.compile(r'''(["'`])((?:(?:\./|\.\./)*)assets/[^"'\s<>`]+)\1''')
URL_ATTRS = {'src', 'poster', 'background', 'data-src', 'data-poster'}
MIME = {'.svg': 'image/svg+xml', '.webp': 'image/webp', '.webm': 'video/webm'}


class Packer(HTMLParser):
    def __init__(self, entry):
        super().__init__(convert_charrefs=False)
        self.entry = entry
        self.root = entry.parent.resolve()
        self.parts = []
        self.assets = {}
        self.scripts = set()
        self.styles = set()
        self.active = None

    def local_path(self, value, base):
        parsed = urlsplit(value.strip())
        if not parsed.path or parsed.scheme or parsed.netloc:
            return None
        raw_path = unquote(parsed.path)
        path = (base / raw_path).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f'Path leaves prototype directory: {value}')
        if not path.is_file():
            raise FileNotFoundError(f'Unresolved resource {value!r} relative to {base}')
        return path

    def embed(self, value, base):
        path = self.local_path(value, base)
        if path is None:
            return value
        if path not in self.assets:
            mime = MIME.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0]
            if not mime:
                raise ValueError(f'Unknown MIME type for {path}')
            self.assets[path] = f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()
        fragment = urlsplit(value).fragment
        return self.assets[path] + (f'#{fragment}' if fragment else '')

    def embed_srcset(self, value):
        # URL tokens may themselves contain commas (notably data: URLs). A trailing
        # comma or the comma after a descriptor separates two candidates.
        result = []
        length = len(value)
        pos = 0
        while pos < length:
            while pos < length and (value[pos].isspace() or value[pos] == ','):
                pos += 1
            start = pos
            while pos < length and not value[pos].isspace():
                pos += 1
            token = value[start:pos]
            if not token:
                break
            if token.endswith(','):
                result.append(self.embed(token.rstrip(','), self.root))
                continue
            desc_start = pos
            level = 0
            while pos < length:
                char = value[pos]
                if char == ',' and level == 0:
                    break
                if char == '(':
                    level += 1
                if char == ')' and level > 0:
                    level -= 1
                pos += 1
            result.append(self.embed(token, self.root) + value[desc_start:pos].rstrip())
        return ', '.join(result)

    def css(self, content, base):
        def url(match):
            original = next(s for s in match.groups() if s is not None).strip()
            return 'url("' + self.embed(original, base) + '")' if self.local_path(original, base) else match[0]
        return CSS_URL.sub(url, content)

    def javascript(self, content, source_dir):
        def resource(match):
            quote, value = match.groups()
            # In this prototype JS assigns paths to DOM elements, relative to index.html.
            base = source_dir if value.startswith('../') else self.root
            return quote + self.embed(value, base) + quote
        return SCRIPT_ASSET.sub(resource, content)

    @staticmethod
    def csp(policy):
        directives = [part.strip() for part in policy.split(';') if part.strip()]
        out = []
        for directive in directives:
            kind, *sources = directive.split()
            if kind in {'script-src', 'style-src'}:
                sources = [s for s in sources if s not in {"'self'", "'none'", "'unsafe-inline'"}]
                sources.append("'unsafe-inline'")
            elif kind in {'media-src', 'img-src', 'font-src'}:
                sources = [s for s in sources if s not in {"'self'", "'none'"}]
                if 'data:' not in sources:
                    sources.append('data:')
            out.append(' '.join([kind, *sources]))
        return ';'.join(out)

    def patch_tag(self, raw, changes, tag=None):
        if tag:
            raw = re.sub(r'^<[^\s/>]+', '<' + tag, raw)
        def replace(match):
            name = match['name'].lower()
            if name not in changes:
                return match[0]
            value = changes[name]
            if value is None:
                return ''
            return match['space'] + match['name'] + '="' + html.escape(value, quote=True) + '"'
        return ATTR.sub(replace, raw)

    def handle_startendtag(self, tag, attrs):
        self.start(tag, attrs, True)

    def handle_starttag(self, tag, attrs):
        self.start(tag, attrs, False)

    def start(self, tag, attrs, closed):
        attrs = dict(attrs)
        raw = self.get_starttag_text()
        changes = {}
        if tag == 'link' and 'stylesheet' in (attrs.get('rel') or '').split():
            path = self.local_path(attrs.get('href', ''), self.root)
            if path is None:
                raise ValueError(f'Cannot bundle stylesheet {attrs.get("href")}')
            css = self.css(path.read_text(encoding='utf8'), path.parent)
            self.styles.add(path)
            self.parts.extend([self.patch_tag(raw.rstrip('/>') + '>', {'href':None, 'rel':None}, 'style'),
                               css, '</style>'])
            return
        if tag == 'script' and 'src' in attrs:
            path = self.local_path(attrs['src'], self.root)
            if path is None:
                raise ValueError(f'Cannot bundle script {attrs["src"]}')
            self.scripts.add(path)
            source = self.javascript(path.read_text(encoding='utf8'), path.parent)
            source = re.sub(r'</script', lambda _: r'<\/script', source, flags=re.I)
            self.parts.extend([self.patch_tag(raw, {'src':None}), source])
            self.active = 'bundled-script'
            return
        for name, value in attrs.items():
            if not value:
                continue
            if name in URL_ATTRS or (name in {'href','xlink:href'} and tag in {'use','image','link'}):
                if self.local_path(value, self.root):
                    changes[name] = self.embed(value, self.root)
            elif name in {'srcset', 'imagesrcset'}:
                changes[name] = self.embed_srcset(value)
            elif name == 'style':
                changes[name] = self.css(value, self.root)
            elif tag=='meta' and name=='content' and attrs.get('http-equiv','').lower()=='content-security-policy':
                changes[name] = self.csp(value)
        self.parts.append(self.patch_tag(raw, changes) if changes else raw)
        if not closed and tag in {'script','style'}:
            self.active = tag

    def handle_endtag(self, tag):
        self.parts.append(f'</{tag}>')
        if tag in {'style', 'script'}:
            self.active = None

    def handle_data(self, data):
        if self.active == 'style':
            data = self.css(data, self.root)
        elif self.active == 'script':
            data = self.javascript(data, self.root)
        self.parts.append(data)

    def handle_comment(self, data):
        self.parts.append('<!--' + data + '-->')

    def handle_decl(self, decl):
        self.parts.append('<!' + decl + '>')

    def handle_entityref(self, name):
        self.parts.append('&' + name + ';')

    def handle_charref(self, name):
        self.parts.append('&#' + name + ';')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='index.html or its containing directory')
    parser.add_argument('output', type=Path, help='Output single-file HTML')
    args = parser.parse_args()
    entry = (args.source / 'index.html' if args.source.is_dir() else args.source).resolve()
    if entry == args.output.resolve():
        parser.error('Use an output path different from the input')
    bundler = Packer(entry)
    bundler.feed(entry.read_text(encoding='utf8'))
    bundler.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(''.join(bundler.parts), encoding='utf8')
    print(f'{args.output} • {args.output.stat().st_size:,} bytes • '
          f'{len(bundler.styles)} stylesheets, {len(bundler.scripts)} scripts, {len(bundler.assets)} media assets')


if __name__ == '__main__':
    main()
