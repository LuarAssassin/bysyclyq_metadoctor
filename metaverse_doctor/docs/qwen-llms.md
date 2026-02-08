# Qwen

## 会用到的模型——以此为主，而不是示例中的模型名
- qwen-plus-latest
- qwen-max-latest
- qwen-long
- qwen3-vl-plus
- fun-asr

## 快速测试连通情况

```python
import os
from openai import OpenAI

# 注意: 不同地域的base_url不通用（下方示例使用北京地域的 base_url）
# - 华北2（北京）: https://dashscope.aliyuncs.com/compatible-mode/v1
client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
completion = client.chat.completions.create(
    model="qwen-plus",
    messages=[{'role': 'user', 'content': '你是谁？'}]
)
print(completion.choices[0].message.content)
```

## 多轮对话
- 上下文管理
- 上下文截断
- 滚动摘要
（为了在不丢失核心信息的前提下动态压缩对话历史，控制上下文长度，可随着对话的进行对上下文进行摘要：

a. 对话历史达到一定长度（如上下文长度最大值的 70%）时，将对话历史中较早的部分（如前一半）提取出来，发起独立 API 调用使大模型对这部分内容生成“记忆摘要”；

b. 构建下一次请求时，用“记忆摘要”替换冗长的对话历史，并拼接最近的几轮对话。）

### 快速开始

```python
import os
from dashscope import Generation
import dashscope 
# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

def get_response(messages):
    response = Generation.call(
        # 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
        # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
        api_key=os.getenv("DASHSCOPE_API_KEY"),
        # 模型列表：https://help.aliyun.com/zh/model-studio/getting-started/models
        model="qwen-plus",
        messages=messages,
        result_format="message",
    )
    return response

# 初始化一个 messages 数组
messages = [
    {
        "role": "system",
        "content": """你是一名阿里云百炼手机商店的店员，你负责给用户推荐手机。手机有两个参数：屏幕尺寸（包括6.1英寸、6.5英寸、6.7英寸）、分辨率（包括2K、4K）。
        你一次只能向用户提问一个参数。如果用户提供的信息不全，你需要反问他，让他提供没有提供的参数。如果参数收集完成，你要说：我已了解您的购买意向，请稍等。""",
    }
]

assistant_output = "欢迎光临阿里云百炼手机商店，您需要购买什么尺寸的手机呢？"
print(f"模型输出：{assistant_output}\n")
while "我已了解您的购买意向" not in assistant_output:
    user_input = input("请输入：")
    # 将用户问题信息添加到messages列表中
    messages.append({"role": "user", "content": user_input})
    assistant_output = get_response(messages).output.choices[0].message.content
    # 将大模型的回复信息添加到messages列表中
    messages.append({"role": "assistant", "content": assistant_output})
    print(f"模型输出：{assistant_output}")
    print("\n")
```

### 多模态模型的多轮对话
```python
import os
import dashscope 
from dashscope import MultiModalConversation

# 若使用新加坡地域的模型，请取消下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

messages = [
    {
        "role": "user",
        "content": [
            {
                "image": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251031/ownrof/f26d201b1e3f4e62ab4a1fc82dd5c9bb.png"
            },
            {"text": "请问图片展现了有哪些商品？"},
        ],
    }
]
response = MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx",
    # 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model='qwen3-vl-plus',   # 可按需更换为其它多模态模型，并修改相应的 messages
    messages=messages)
print(f"模型第一轮输出：{response.output.choices[0].message.content[0]['text']}")

messages.append(response['output']['choices'][0]['message'])
user_msg = {"role": "user", "content": [{"text": "它们属于什么风格？"}]}
messages.append(user_msg)
response = MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx",
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model='qwen3-vl-plus',
    messages=messages)
    
print(f"模型第二轮输出：{response.output.choices[0].message.content[0]['text']}")
```

## 思考模型的多轮对话
- 思考模型返回reasoning_content（思考过程）与content（回复内容）两个字段。更新 messages 数组时，仅保留content字段，忽略reasoning_content字段。

```python
import os
import dashscope

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

messages = []
conversation_idx = 1
while True:
    print("=" * 20 + f"第{conversation_idx}轮对话" + "=" * 20)
    conversation_idx += 1
    user_msg = {"role": "user", "content": input("请输入你的消息：")}
    messages.append(user_msg)
    response = dashscope.Generation.call(
        # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
        api_key=os.getenv('DASHSCOPE_API_KEY'),
         # 此处以qwen-plus为例，可按需更换为其它深度思考模型
        model="qwen-plus", 
        messages=messages,
        enable_thinking=True,
        result_format="message",
        stream=True,
        incremental_output=True
    )
    # 定义完整思考过程
    reasoning_content = ""
    # 定义完整回复
    answer_content = ""
    # 判断是否结束思考过程并开始回复
    is_answering = False
    print("=" * 20 + "思考过程" + "=" * 20)
    for chunk in response:
        # 如果思考过程与回复皆为空，则忽略
        if (chunk.output.choices[0].message.content == "" and 
            chunk.output.choices[0].message.reasoning_content == ""):
            pass
        else:
            # 如果当前为思考过程
            if (chunk.output.choices[0].message.reasoning_content != "" and 
                chunk.output.choices[0].message.content == ""):
                print(chunk.output.choices[0].message.reasoning_content, end="",flush=True)
                reasoning_content += chunk.output.choices[0].message.reasoning_content
            # 如果当前为回复
            elif chunk.output.choices[0].message.content != "":
                if not is_answering:
                    print("\n" + "=" * 20 + "完整回复" + "=" * 20)
                    is_answering = True
                print(chunk.output.choices[0].message.content, end="",flush=True)
                answer_content += chunk.output.choices[0].message.content
    # 将模型回复的content添加到上下文中
    messages.append({"role": "assistant", "content": answer_content})
    print("\n")
    # 如果您需要打印完整思考过程与完整回复，请将以下代码解除注释后运行
    # print("=" * 20 + "完整思考过程" + "=" * 20 + "\n")
    # print(f"{reasoning_content}")
    # print("=" * 20 + "完整回复" + "=" * 20 + "\n")
    # print(f"{answer_content}")
```

## 流式输出
### 快速开始
```python
import os
from http import HTTPStatus
import dashscope
from dashscope import Generation

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

# 1. 准备工作：配置API Key
# 建议通过环境变量配置API Key，避免硬编码。
try:
    dashscope.api_key = os.environ["DASHSCOPE_API_KEY"]
except KeyError:
    raise ValueError("请设置环境变量 DASHSCOPE_API_KEY")

# 2. 发起流式请求
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "请介绍一下自己"},
]

try:
    responses = Generation.call(
        model="qwen-plus",
        messages=messages,
        result_format="message",
        stream=True,
        # 关键：设置为True以获取增量输出，性能更佳。
        incremental_output=True,
    )

    # 3. 处理流式响应
    content_parts = []
    print("AI: ", end="", flush=True)

    for resp in responses:
        if resp.status_code == HTTPStatus.OK:
            content = resp.output.choices[0].message.content
            print(content, end="", flush=True)
            content_parts.append(content)

            # 检查是否是最后一个包
            if resp.output.choices[0].finish_reason == "stop":
                usage = resp.usage
                print("\n--- 请求用量 ---")
                print(f"输入 Tokens: {usage.input_tokens}")
                print(f"输出 Tokens: {usage.output_tokens}")
                print(f"总计 Tokens: {usage.total_tokens}")
        else:
            # 处理错误情况
            print(
                f"\n请求失败: request_id={resp.request_id}, code={resp.code}, message={resp.message}"
            )
            break

    full_response = "".join(content_parts)
    # print(f"\n--- 完整回复 ---\n{full_response}")

except Exception as e:
    print(f"发生未知错误: {e}")
```

### 多模态模型的流式输出
```python
import os
from dashscope import MultiModalConversation
import dashscope

# 若使用新加坡地域的模型，请取消下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

messages = [
    {
        "role": "user",
        "content": [
            {"image": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg"},
            {"text": "图中描绘的是什么景象?"}
        ]
    }
]

responses = MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
    # 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model='qwen3-vl-plus',  # 可按需更换为其它多模态模型，并修改相应的 messages
    messages=messages,
    stream=True,
    incremental_output=True
    )
    
full_content = ""
print("流式输出内容为：")
for response in responses:
    if response.output.choices[0].message.content:
        print(response.output.choices[0].message.content[0]['text'])
        full_content += response.output.choices[0].message.content[0]['text']
print(f"完整内容为：{full_content}")
```

### 思考模型的流式输出

```python
import os
from dashscope import Generation
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"
messages = [{"role": "user", "content": "你是谁？"}]


completion = Generation.call(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key = "sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 可按需更换为其它深度思考模型
    model="qwen-plus",
    messages=messages,
    result_format="message", # Qwen3开源版模型只支持设定为"message"；为了更好的体验，其它模型也推荐您优先设定为"message"
    # 开启深度思考，该参数对qwen3-30b-a3b-thinking-2507、qwen3-235b-a22b-thinking-2507、QwQ、DeepSeek-R1 模型无效
    enable_thinking=True,
    stream=True,
    incremental_output=True, # Qwen3开源版模型只支持 true；为了更好的体验，其它模型也推荐您优先设定为 true
)

# 定义完整思考过程
reasoning_content = ""
# 定义完整回复
answer_content = ""
# 判断是否结束思考过程并开始回复
is_answering = False

print("=" * 20 + "思考过程" + "=" * 20)

for chunk in completion:
    # 如果思考过程与回复皆为空，则忽略
    if (
        chunk.output.choices[0].message.content == ""
        and chunk.output.choices[0].message.reasoning_content == ""
    ):
        pass
    else:
        # 如果当前为思考过程
        if (
            chunk.output.choices[0].message.reasoning_content != ""
            and chunk.output.choices[0].message.content == ""
        ):
            print(chunk.output.choices[0].message.reasoning_content, end="", flush=True)
            reasoning_content += chunk.output.choices[0].message.reasoning_content
        # 如果当前为回复
        elif chunk.output.choices[0].message.content != "":
            if not is_answering:
                print("\n" + "=" * 20 + "完整回复" + "=" * 20)
                is_answering = True
            print(chunk.output.choices[0].message.content, end="", flush=True)
            answer_content += chunk.output.choices[0].message.content

# 如果您需要打印完整思考过程与完整回复，请将以下代码解除注释后运行
# print("=" * 20 + "完整思考过程" + "=" * 20 + "\n")
# print(f"{reasoning_content}")
# print("=" * 20 + "完整回复" + "=" * 20 + "\n")
# print(f"{answer_content}")
```
- 性能与资源管理：在后端服务中，为每个流式请求维持一个HTTP长连接会消耗资源。确保您的服务配置了合理的连接池大小和超时时间。在高并发场景下，监控服务的文件描述符（file descriptors）使用情况，防止耗尽。
- 客户端渲染：在Web前端，使用 ReadableStream 和 TextDecoderStream API 可以平滑地处理和渲染SSE事件流，提供最佳的用户体验。
- 若使用 Nginx 作为反向代理，其默认的输出缓冲（proxy_buffering）会破坏流式响应的实时性。为确保数据能被即时推送到客户端，务必在Nginx配置文件中设置proxy_buffering off以关闭此功能。
- OpenAI 协议默认不返回 usage 信息，设置stream_options参数使得最后返回的包中包含 usage 信息。

## 深度思考
```python
import os
from dashscope import Generation
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

# 初始化请求参数
messages = [{"role": "user", "content": "你是谁？"}]

completion = Generation.call(
    # 如果没有配置环境变量，请用阿里云百炼API Key替换：api_key="sk-xxx"
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=messages,
    result_format="message",  # 设置结果格式为 message
    enable_thinking=True,     # 开启思考过程
    stream=True,              # 开启流式输出
    incremental_output=True,  # 开启增量输出
)

reasoning_content = ""  # 完整思考过程
answer_content = ""     # 完整回复
is_answering = False    # 是否进入回复阶段

print("\n" + "=" * 20 + "思考过程" + "=" * 20 + "\n")

for chunk in completion:
    message = chunk.output.choices[0].message
    
    # 只收集思考内容
    if message.reasoning_content:
        if not is_answering:
            print(message.reasoning_content, end="", flush=True)
        reasoning_content += message.reasoning_content

    # 收到 content，开始进行回复
    if message.content:
        if not is_answering:
            print("\n" + "=" * 20 + "完整回复" + "=" * 20 + "\n")
            is_answering = True
        print(message.content, end="", flush=True)
        answer_content += message.content

print("\n" + "=" * 20 + "Token 消耗" + "=" * 20 + "\n")
print(chunk.usage)
# 循环结束后，reasoning_content 和 answer_content 变量中包含了完整的内容
# 您可以在这里根据需要进行后续处理
# print(f"\n\n完整思考过程:\n{reasoning_content}")
# print(f"\n完整回复:\n{answer_content}")
```

```python
import os
from dashscope import Generation
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

messages = [{"role": "user", "content": "你是谁？"}]


completion = Generation.call(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key = "sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=messages,
    result_format="message",
    enable_thinking=True,
    # 设置最大推理过程 Token 数
    thinking_budget=50,
    stream=True,
    incremental_output=True,
)

# 定义完整思考过程
reasoning_content = ""
# 定义完整回复
answer_content = ""
# 判断是否结束思考过程并开始回复
is_answering = False

print("=" * 20 + "思考过程" + "=" * 20)

for chunk in completion:
    # 如果思考过程与回复皆为空，则忽略
    if (
        chunk.output.choices[0].message.content == ""
        and chunk.output.choices[0].message.reasoning_content == ""
    ):
        pass
    else:
        # 如果当前为思考过程
        if (
            chunk.output.choices[0].message.reasoning_content != ""
            and chunk.output.choices[0].message.content == ""
        ):
            print(chunk.output.choices[0].message.reasoning_content, end="", flush=True)
            reasoning_content += chunk.output.choices[0].message.reasoning_content
        # 如果当前为回复
        elif chunk.output.choices[0].message.content != "":
            if not is_answering:
                print("\n" + "=" * 20 + "完整回复" + "=" * 20)
                is_answering = True
            print(chunk.output.choices[0].message.content, end="", flush=True)
            answer_content += chunk.output.choices[0].message.content

# 如果您需要打印完整思考过程与完整回复，请将以下代码解除注释后运行
# print("=" * 20 + "完整思考过程" + "=" * 20 + "\n")
# print(f"{reasoning_content}")
# print("=" * 20 + "完整回复" + "=" * 20 + "\n")
# print(f"{answer_content}")
```

## 联网搜索

```python
import os
from dashscope import Generation
import dashscope 

# 若使用新加坡地域的模型，请释放下列注释
# dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"

messages = [{"role": "user", "content": "你是谁？"}]


completion = Generation.call(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key = "sk-xxx",
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=messages,
    result_format="message",
    enable_thinking=True,
    # 设置最大推理过程 Token 数
    thinking_budget=50,
    stream=True,
    incremental_output=True,
)

# 定义完整思考过程
reasoning_content = ""
# 定义完整回复
answer_content = ""
# 判断是否结束思考过程并开始回复
is_answering = False

print("=" * 20 + "思考过程" + "=" * 20)

for chunk in completion:
    # 如果思考过程与回复皆为空，则忽略
    if (
        chunk.output.choices[0].message.content == ""
        and chunk.output.choices[0].message.reasoning_content == ""
    ):
        pass
    else:
        # 如果当前为思考过程
        if (
            chunk.output.choices[0].message.reasoning_content != ""
            and chunk.output.choices[0].message.content == ""
        ):
            print(chunk.output.choices[0].message.reasoning_content, end="", flush=True)
            reasoning_content += chunk.output.choices[0].message.reasoning_content
        # 如果当前为回复
        elif chunk.output.choices[0].message.content != "":
            if not is_answering:
                print("\n" + "=" * 20 + "完整回复" + "=" * 20)
                is_answering = True
            print(chunk.output.choices[0].message.content, end="", flush=True)
            answer_content += chunk.output.choices[0].message.content

# 如果您需要打印完整思考过程与完整回复，请将以下代码解除注释后运行
# print("=" * 20 + "完整思考过程" + "=" * 20 + "\n")
# print(f"{reasoning_content}")
# print("=" * 20 + "完整回复" + "=" * 20 + "\n")
# print(f"{answer_content}")
```

search_strategy可选值:

turbo （默认）: 兼顾响应速度与搜索效果，适用于大多数场景。

自2026年2月27日起，启用该策略时额外收费，参见计费说明。
max: 采用更全面的搜索策略，可调用多源搜索引擎，以获取更详尽的搜索结果，但响应时间可能更长。

自2026年2月27日起，启用该策略时额外收费，参见计费说明。
agent：可多次调用联网搜索工具与大模型，实现多轮信息检索与内容整合。

该策略仅适用于 qwen3-max、qwen3-max-2026-01-23、qwen3-max-2025-09-23。
启用该策略时，仅支持返回搜索来源（enable_source: true），其他联网搜索功能不可用。
启用该策略时，每次调用额外收费，参见计费说明。
agent_max：在agent策略基础上支持网页抓取，参见：网页抓取。

该策略仅适用于qwen3-max、qwen3-max-2026-01-23的思考模式。
启用该策略时，仅支持返回搜索来源（enable_source: true），其他联网搜索功能不可用。
启用该策略时，每次调用额外收费，参见计费说明。

默认情况下，模型会判断是否需要联网。如果业务场景强依赖实时信息，可设置 forced_search 参数为true，强制执行联网搜索。

forced_search可选值:

true: 强制联网搜索。

false (默认): 模型判断是否需要联网。

```python
import os
import dashscope

response = dashscope.Generation.call(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    model="qwen-plus",
    messages=[{"role": "user", "content": "杭州明天天气是什么？"}],
    enable_search=True,
    search_options={
        "forced_search": True  # 强制联网搜索
    },
    result_format="message"
)
print(response["output"]["choices"][0]["message"]["content"])
```

获取并标注引用来源
为确保信息的可追溯性，可设置模型在返回结果中包含搜索来源链接，并在正文中通过角标进行标注。

开启返回搜索来源: 设置 enable_source: true，响应的 search_info 字段将包含搜索结果列表。

开启角标标注: 在 enable_source 为 true 的前提下，设置 enable_citation: true，模型回复内容中将出现类似 [1] 的角标。

设置角标样式: 通过citation_format参数设置，可选值：

"[<number>]" (默认): 样式为 [1]

"[ref_<number>]": 样式为 [ref_1]

仅支持 DashScope 调用方式。

```python
import os
import dashscope

response = dashscope.Generation.call(
    api_key=os.getenv("DASHSCOPE_API_KEY", "YOUR_API_KEY"),
    model="qwen-plus",
    messages=[{"role": "user", "content": "杭州明天天气是什么？"}],
    enable_search=True,
    search_options={
        "enable_source": True,       # 必须开启才能使用角标标注
        "enable_citation": True,     # 开启角标标注
        "citation_format": "[ref_<number>]", # 设置角标样式
    },
    result_format="message"
)

print("="*20 + "搜索结果" + "="*20)
for web in response.output.search_info["search_results"]:
    print(f"[{web['index']}]: [{web['title']}]({web['url']})")
print("="*20 + "回复内容" + "="*20)
print(response.output.choices[0].message.content)
```
更多内容：https://bailian.console.aliyun.com/cn-beijing/?spm=5176.29597918.nav-v2-dropdown-menu-0.d_main_0_0_4.74017b08rgJ4Wy&tab=doc&scm=20140722.M_10838610._.V_1#/doc/?type=model&url=2867560
包括联网搜索的各种细节功能。

## 长上下文

```python
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处替换您的API-KEY
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",  # 填写DashScope服务base_url
)

file_object = client.files.create(file=Path("阿里云百炼系列手机产品介绍.docx"), purpose="file-extract")
print(file_object.id)
```
```python
import os
from openai import OpenAI, BadRequestError

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处替换您的API-KEY
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",  # 填写DashScope服务base_url
)
try:
    # 初始化messages列表
    completion = client.chat.completions.create(
        model="qwen-long",
        messages=[
            # sys1: 角色定义
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            # sys2: 文档内容（纯文本或file-id）
            # 请将 '{FILE_ID}'替换为您实际对话场景所使用的 fileid
            {'role': 'system', 'content': f'fileid://{FILE_ID}'},
            # 当请求中包含第 2 条system message时，user消息内容长度限制在 9,000 Token 以内
            {'role': 'user', 'content': '这篇文章讲了什么?'}
        ],
        # 所有代码示例均采用流式输出，以清晰和直观地展示模型输出过程。如果您希望查看非流式输出的案例，请参见https://help.aliyun.com/zh/model-studio/text-generation
        stream=True,
        stream_options={"include_usage": True}
    )

    full_content = ""
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            # 拼接输出内容
            full_content += chunk.choices[0].delta.content
            print(chunk.model_dump())
        
        # 获取 token 使用情况
        if chunk.usage:
            print(f"总计 tokens: {chunk.usage.total_tokens}")

    print(full_content)

except BadRequestError as e:
    print(f"错误信息：{e}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
```

```python
import os
from openai import OpenAI, BadRequestError

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处替换您的API-KEY
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",  # 填写DashScope服务base_url
)
try:
    # 初始化messages列表
    completion = client.chat.completions.create(
        model="qwen-long",
        messages=[
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            # 请将 '{FILE_ID1}' 和 '{FILE_ID2}' 替换为您实际对话场景所使用的 fileid。
            {'role': 'system', 'content': f"fileid://{FILE_ID1},fileid://{FILE_ID2}"},
            {'role': 'user', 'content': '这几篇文章讲了什么？'}
        ],
        # 所有代码示例均采用流式输出，以清晰和直观地展示模型输出过程。如果您希望查看非流式输出的案例，请参见https://help.aliyun.com/zh/model-studio/text-generation
        stream=True,
        stream_options={"include_usage": True}
    )
    
    full_content = ""
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            # 拼接输出内容
            full_content += chunk.choices[0].delta.content
            print(chunk.model_dump())
        
        # 获取 token 使用情况
        if chunk.usage:
            print(f"总计 tokens: {chunk.usage.total_tokens}")
    
    print(full_content)

except BadRequestError as e:
    print(f"错误信息：{e}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")


```
如何确定文件已经解析完成？

获取 file-id 后，可以尝试使用该 file-id 与模型进行对话。若文件尚未解析完成，系统将返回错误码 400，并提示“File parsing in progress, please try again later.”；若模型调用成功并返回了回复内容，则表示文件已解析完成。

限制
SDK 依赖：

文件上传、删除、查询等管理操作必须使用 OpenAI 兼容 SDK。

模型调用可使用 OpenAI 兼容 SDK 或 Dashscope SDK。

文件上传：

支持格式：TXT, DOCX, PDF, XLSX, EPUB, MOBI, MD, CSV, JSON, BMP, PNG, JPG/JPEG, GIF。

文件大小：图片格式文件上限 20MB，其他格式文件上限 150MB。

账户配额：单个账户最多上传 1 万个文件，总大小不超过 100GB。当文件数量或总大小达到任一上限时，新的文件上传请求将会失败。请先参考OpenAI兼容-File，删除不再需要的文件以释放配额，然后才能继续上传。

存储有效期：当前暂无有效期限制。

API 输入：

第 1 条 system 消息用于角色定义，第 2 条 system 消息用于传入文档内容或 fileid://xxx，user 消息用于用户提问。

通过 file-id 引用时，单次请求最多引用 100 个文件。

当请求中包含第 2 条system 消息（即存在两个 system 消息）时，user消息的内容长度不得超过 9,000 Token。仅当请求中不存在第 2 条 system 消息时，user 消息才不受此限制。

总上下文长度上限为 1000 万 Token。

API 输出：

最大输出长度为 32,768 Token。

文件共享：

file-id 仅在生成它的阿里云主账号内有效，不支持跨账号或通过 RAM 用户 API Key 调用。

免费额度：100万Token的免费额度仅在阿里云百炼开通后的90天内有效。使用超出免费额度的部分将按照相应的输入输出成本收费。

## 数据挖掘
```python
import os
import dashscope

response = dashscope.Generation.call(
    api_key=os.getenv('DASHSCOPE_API_KEY'), # 如果您没有配置环境变量，请在此处替换您的API-KEY
    model='qwen-doc-turbo',
    messages=[
    {"role": "system","content": "You are a helpful assistant."},
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "从这两份产品手册中，提取所有产品信息，并整理成一个标准的JSON数组。每个对象需要包含：model(产品的型号)、name(产品的名称)、price(价格（去除货币符号和逗号）)"
            },
            {
                "type": "doc_url",
                "doc_url": [
                    "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251107/jockge/%E7%A4%BA%E4%BE%8B%E4%BA%A7%E5%93%81%E6%89%8B%E5%86%8CA.docx",
                    "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251107/ztwxzr/%E7%A4%BA%E4%BE%8B%E4%BA%A7%E5%93%81%E6%89%8B%E5%86%8CB.docx"
                ],
                "file_parsing_strategy": "auto"
            }
        ]
    }]
)
try:
    if response.status_code == 200:
        print(response.output.choices[0].message.content)
    else:
        print(f"请求失败，状态码: {response.status_code}")
        print(f"错误代码: {response.code}")
        print(f"错误信息: {response.message}")
        print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
except Exception as e:
    print(f"发生错误: {e}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
```
```python
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处替换您的API-KEY
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",  # 填写DashScope服务base_url
)

file_object = client.files.create(file=Path("示例产品手册A.docx"), purpose="file-extract")
# 打印file-id用于后续模型对话
print(file_object.id)
```

```python
import os
from openai import OpenAI, BadRequestError

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"), # 如果您没有配置环境变量，请在此处替换您的API-KEY
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

try:
    completion = client.chat.completions.create(
        model="qwen-doc-turbo",
        messages=[
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            # 请将 '{FILE_ID}'替换为您实际对话场景所使用的 fileid
            {'role': 'system', 'content': 'fileid://{FILE_ID}'},
            {'role': 'user', 'content': '从这份产品手册中，提取所有产品信息，并整理成一个标准的JSON数组。每个对象需要包含：model(产品的型号)、name(产品的名称)、price(价格（去除货币符号和逗号）) '}
        ],
        # 本代码示例采用流式输出，以清晰和直观地展示模型输出过程。如果您希望查看非流式输出的案例，请参见https://help.aliyun.com/zh/model-studio/text-generation
        stream=True,
        stream_options={"include_usage": True}
    )

    full_content = ""
    for chunk in completion:
        if chunk.choices and chunk.choices[0].delta.content:
            full_content += chunk.choices[0].delta.content
            print(chunk.model_dump())
    
    print(full_content)

except BadRequestError as e:
    print(f"错误信息：{e}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
```

通过文件URL方式上传时，文件解析策略（file_parsing_strategy）参数有什么不同？

当解析策略设置为 "auto" 时，系统会根据文件内容自动进行解析；当解析策略设置为 "text_only" 时，系统将仅解析文字类内容；当解析策略设置为“text_and_images”时，系统将会解析所有图片与文本类内容，解析所需时间也会相应增加。

如何确定文件已经解析完成？

获取 file-id 后，您可以直接尝试使用该ID与模型进行对话。如果文件仍在解析中，API会返回相应的错误提示File parsing in progress, please try again later.，此时请稍后重试。如果模型调用成功并返回了回复，则表示文件已解析完成，可以正常使用。
限制
SDK 依赖：

文件URL (doc_url): 文件URL方式当前仅支持DashScope协议，可以选择使用DashScope Python SDK或者HTTP方式调用（如curl）

上传文件 (file-id): 文件上传与管理操作 必须 使用 OpenAI 兼容 SDK。

文件上传与引用：

文件URL (doc_url): 单次请求最多支持 10 个文件URL，且传入的URL需确保公网可访问。

上传文件 (file-id): 单个文件不超过 150MB。单个阿里云账号最多可上传 1 万个文件，总大小不超过 100GB，当前暂无有效期限制。单次请求最多引用 1 个文件。

使用文件ID传入时，当文件数量或总大小达到任一上限时，新的文件上传请求将会失败。请参考OpenAI兼容-File，及时删除不再需要的文件以释放配额，然后才能继续上传。
支持格式：TXT, DOC, DOCX, PDF, XLS, XLSX, MD, PPT, PPTX, JPG, JPEG, PNG, GIF, BMP。

API 输入：

通过doc_url或 file-id 引入信息时，上下文长度上限为 262,144 Token。

直接在 user 或 system 消息中输入纯文本时，单条消息内容限制在 9,000 Token 以内。

API 输出：

最大输出长度为 32,768 Token。

文件共享：

file-id 仅在生成它的阿里云主账号内有效，不支持跨账号或通过 RAM 用户 API Key 调用。

限流：关于模型的限流条件，请参见限流。

## 视觉理解
```python
import os
import dashscope
from dashscope import MultiModalConversation

# 以下为北京地域base_url，若使用弗吉尼亚地域模型，需要将base_url换成 https://dashscope-us.aliyuncs.com/api/v1
# 若使用新加坡地域的模型，需将base_url替换为：https://dashscope-intl.aliyuncs.com/api/v1
dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

enable_thinking=True
messages = [
    {
        "role": "user",
        "content": [
            {"image": "https://img.alicdn.com/imgextra/i1/O1CN01gDEY8M1W114Hi3XcN_!!6000000002727-0-tps-1024-406.jpg"},
            {"text": "解答这道题？"}
        ]
    }
]

response = MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx",
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model="qwen3-vl-plus",
    messages=messages,
    stream=True,
    # enable_thinking 参数开启思考过程
    # qwen3-vl-plus、 qwen3-vl-flash可通过enable_thinking开启或关闭思考、对于qwen3-vl-235b-a22b-thinking等带thinking后缀的模型，enable_thinking仅支持设置为开启，对其他Qwen-VL模型均不适用
    enable_thinking=enable_thinking,
    # thinking_budget 参数设置最大推理过程 Token 数
    thinking_budget=81920,

)

# 定义完整思考过程
reasoning_content = ""
# 定义完整回复
answer_content = ""
# 判断是否结束思考过程并开始回复
is_answering = False
if enable_thinking:
    print("=" * 20 + "思考过程" + "=" * 20)

for chunk in response:
    # 如果思考过程与回复皆为空，则忽略
    message = chunk.output.choices[0].message
    reasoning_content_chunk = message.get("reasoning_content", None)
    if (chunk.output.choices[0].message.content == [] and
        reasoning_content_chunk == ""):
        pass
    else:
        # 如果当前为思考过程
        if reasoning_content_chunk is not None and chunk.output.choices[0].message.content == []:
            print(chunk.output.choices[0].message.reasoning_content, end="")
            reasoning_content += chunk.output.choices[0].message.reasoning_content
        # 如果当前为回复
        elif chunk.output.choices[0].message.content != []:
            if not is_answering:
                print("\n" + "=" * 20 + "完整回复" + "=" * 20)
                is_answering = True
            print(chunk.output.choices[0].message.content[0]["text"], end="")
            answer_content += chunk.output.choices[0].message.content[0]["text"]

# 如果您需要打印完整思考过程与完整回复，请将以下代码解除注释后运行
# print("=" * 20 + "完整思考过程" + "=" * 20 + "\n")
# print(f"{reasoning_content}")
# print("=" * 20 + "完整回复" + "=" * 20 + "\n")
# print(f"{answer_content}")
```

### 多图像
```python
import os
import dashscope

# 以下为北京地域base_url，若使用弗吉尼亚地域模型，需要将base_url换成 https://dashscope-us.aliyuncs.com/api/v1
# 若使用新加坡地域的模型，需将base_url替换为：https://dashscope-intl.aliyuncs.com/api/v1
dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

messages = [
    {
        "role": "user",
        "content": [
            {"image": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg"},
            {"image": "https://dashscope.oss-cn-beijing.aliyuncs.com/images/tiger.png"},
            {"text": "这些图描绘了什么内容?"}
        ]
    }
]

response = dashscope.MultiModalConversation.call(
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
    # 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model='qwen3-vl-plus', # 此处以qwen3-vl-plus为例，可按需更换模型名称。模型列表：https://help.aliyun.com/zh/model-studio/models
    messages=messages
)

print(response.output.choices[0].message.content[0]["text"])
```

## 视频理解

```python
import dashscope
import os

# 以下为北京地域base_url，若使用弗吉尼亚地域模型，需要将base_url换成 https://dashscope-us.aliyuncs.com/api/v1
# 若使用新加坡地域的模型，需将base_url替换为：https://dashscope-intl.aliyuncs.com/api/v1
dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

messages = [
    {"role": "user",
        "content": [
            # fps 可参数控制视频抽帧频率，表示每隔 1/fps 秒抽取一帧，完整用法请参见：https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api?#2ed5ee7377fum
            {"video": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241115/cqqkru/1.mp4","fps":2},
            {"text": "这段视频的内容是什么?"}
        ]
    }
]

response = dashscope.MultiModalConversation.call(
    # 若没有配置环境变量， 请用百炼API Key将下行替换为： api_key ="sk-xxx"
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    model='qwen3-vl-plus',
    messages=messages
)

print(response.output.choices[0].message.content[0]["text"])
```
当vl_high_resolution_images=true时，API 使用固定分辨率策略，忽略max_pixels设置。适合用于识别图像中的精细文本、微小物体或丰富细节。
公网URL：提供一个公网可访问的文件地址，支持 HTTP 或 HTTPS 协议。为获得最佳稳定性和性能，可将文件上传至OSS或上传文件获取临时URL，获取公网 URL。

重要
为确保模型能成功下载文件，提供的公网 URL的请求头中必须包含 Content-Length（文件大小）和 Content-Type（媒体类型，如 image/jpeg）。任一字段缺失或者错误将会导致文件下载失败。

Base64编码传入：将文件转换为 Base64 编码字符串再传入。

本地文件路径传入（仅限 DashScope SDK）：传入本地文件的路径。

图像大小：

以公网 URL 和本地路径传入时：单个图像的大小不超过10MB。

以 Base64 编码传入时：编码后的字符串不超过10MB。
分辨率在4K(3840x2160)以下，支持的图像格式如下：

图像格式

常见扩展名

MIME Type

BMP

.bmp

image/bmp

JPEG

.jpe, .jpeg, .jpg

image/jpeg

PNG

.png

image/png

TIFF

.tif, .tiff

image/tiff

WEBP

.webp

image/webp

HEIC

.heic

image/heic

视频大小：

以公网 URL 传入时：

Qwen3-VL系列、qwen-vl-max（包含qwen-vl-max-latest、qwen-vl-max-2025-04-08 之后的所有版本）：不超过 2GB；

qwen-vl-plus 系列、其他qwen-vl-max模型、Qwen2.5-VL开源系列及QVQ系列模型：不超过 1GB；

其他模型不超过 150MB

以 Base64 编码传入时：编码后的字符串小于 10MB；

以本地文件路径传入时：视频本身不超过 100MB。
视频时长：

qwen3-vl-plus系列、qwen3-vl-flash系列、qwen3-vl-235b-a22b-thinking、qwen3-vl-235b-a22b-instruct：2 秒至 1 小时；

其他Qwen3-VL开源系列、qwen-vl-max（包含qwen-vl-max-latest、qwen-vl-max-2025-04-08 及之后更新的版本）：2 秒至 20 分钟；

qwen-vl-plus系列、 其他qwen-vl-max模型、Qwen2.5-VL开源系列及QVQ系列模型：2 秒至 10 分钟；

其他模型：2 秒至 40 秒。

视频格式： MP4、AVI、MKV、MOV、FLV、WMV 等

## 录音文件识别-Fun-ASR
```python
from http import HTTPStatus
from dashscope.audio.asr import Transcription
from urllib import request
import dashscope
import os
import json

# 以下为北京地域url，DASHSCOPE_BASE_URL
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

# 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 若没有配置环境变量，请用百炼API Key将下行替换为：dashscope.api_key = "sk-xxx"
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

task_response = Transcription.async_call(
    model='fun-asr',
    file_urls=['https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav',
               'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_male2.wav'],
    language_hints=['zh', 'en']  # language_hints为可选参数，用于指定待识别音频的语言代码。取值范围请参见API参考文档。
)

transcription_response = Transcription.wait(task=task_response.output.task_id)

if transcription_response.status_code == HTTPStatus.OK:
    for transcription in transcription_response.output['results']:
        if transcription['subtask_status'] == 'SUCCEEDED':
            url = transcription['transcription_url']
            result = json.loads(request.urlopen(url).read().decode('utf8'))
            print(json.dumps(result, indent=4,
                            ensure_ascii=False))
        else:
            print('transcription failed!')
            print(transcription)
else:
    print('Error: ', transcription_response.output.message)
```

## 实时语音合成

```python
# coding=utf-8
# Installation instructions for pyaudio:
# APPLE Mac OS X
#   brew install portaudio
#   pip install pyaudio
# Debian/Ubuntu
#   sudo apt-get install python-pyaudio python3-pyaudio
#   or
#   pip install pyaudio
# CentOS
#   sudo yum install -y portaudio portaudio-devel && pip install pyaudio
# Microsoft Windows
#   python -m pip install pyaudio

import pyaudio
import os
import requests
import base64
import pathlib
import threading
import time
import dashscope
from dashscope.audio.qwen_tts_realtime import QwenTtsRealtime, QwenTtsRealtimeCallback, AudioFormat

# ======= 常量配置 =======
DEFAULT_TARGET_MODEL = "qwen3-tts-vc-realtime-2026-01-15"  # 声音复刻、语音合成要使用相同的模型
DEFAULT_PREFERRED_NAME = "guanyu"
DEFAULT_AUDIO_MIME_TYPE = "audio/mpeg"
VOICE_FILE_PATH = "voice.mp3"  # 用于声音复刻的本地音频文件的相对路径

TEXT_TO_SYNTHESIZE = [
    '对吧~我就特别喜欢这种超市，',
    '尤其是过年的时候',
    '去逛超市',
    '就会觉得',
    '超级超级开心！',
    '想买好多好多的东西呢！'
]

def create_voice(file_path: str,
                 target_model: str = DEFAULT_TARGET_MODEL,
                 preferred_name: str = DEFAULT_PREFERRED_NAME,
                 audio_mime_type: str = DEFAULT_AUDIO_MIME_TYPE) -> str:
    """
    创建音色，并返回 voice 参数
    """
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    # 若没有配置环境变量，请用百炼API Key将下行替换为：api_key = "sk-xxx"
    api_key = os.getenv("DASHSCOPE_API_KEY")

    file_path_obj = pathlib.Path(file_path)
    if not file_path_obj.exists():
        raise FileNotFoundError(f"音频文件不存在: {file_path}")

    base64_str = base64.b64encode(file_path_obj.read_bytes()).decode()
    data_uri = f"data:{audio_mime_type};base64,{base64_str}"

    # 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization
    url = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
    payload = {
        "model": "qwen-voice-enrollment", # 不要修改该值
        "input": {
            "action": "create",
            "target_model": target_model,
            "preferred_name": preferred_name,
            "audio": {"data": data_uri}
        }
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    resp = requests.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"创建 voice 失败: {resp.status_code}, {resp.text}")

    try:
        return resp.json()["output"]["voice"]
    except (KeyError, ValueError) as e:
        raise RuntimeError(f"解析 voice 响应失败: {e}")

def init_dashscope_api_key():
    """
    初始化 dashscope SDK 的 API key
    """
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    # 若没有配置环境变量，请用百炼API Key将下行替换为：dashscope.api_key = "sk-xxx"
    dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

# ======= 回调类 =======
class MyCallback(QwenTtsRealtimeCallback):
    """
    自定义 TTS 流式回调
    """
    def __init__(self):
        self.complete_event = threading.Event()
        self._player = pyaudio.PyAudio()
        self._stream = self._player.open(
            format=pyaudio.paInt16, channels=1, rate=24000, output=True
        )

    def on_open(self) -> None:
        print('[TTS] 连接已建立')

    def on_close(self, close_status_code, close_msg) -> None:
        self._stream.stop_stream()
        self._stream.close()
        self._player.terminate()
        print(f'[TTS] 连接关闭 code={close_status_code}, msg={close_msg}')

    def on_event(self, response: dict) -> None:
        try:
            event_type = response.get('type', '')
            if event_type == 'session.created':
                print(f'[TTS] 会话开始: {response["session"]["id"]}')
            elif event_type == 'response.audio.delta':
                audio_data = base64.b64decode(response['delta'])
                self._stream.write(audio_data)
            elif event_type == 'response.done':
                print(f'[TTS] 响应完成, Response ID: {qwen_tts_realtime.get_last_response_id()}')
            elif event_type == 'session.finished':
                print('[TTS] 会话结束')
                self.complete_event.set()
        except Exception as e:
            print(f'[Error] 处理回调事件异常: {e}')

    def wait_for_finished(self):
        self.complete_event.wait()

# ======= 主执行逻辑 =======
if __name__ == '__main__':
    init_dashscope_api_key()
    print('[系统] 初始化 Qwen TTS Realtime ...')

    callback = MyCallback()
    qwen_tts_realtime = QwenTtsRealtime(
        model=DEFAULT_TARGET_MODEL,
        callback=callback,
        # 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
        url='wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
    )
    qwen_tts_realtime.connect()
    
    qwen_tts_realtime.update_session(
        voice=create_voice(VOICE_FILE_PATH), # 将voice参数替换为复刻生成的专属音色
        response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
        mode='server_commit'
    )

    for text_chunk in TEXT_TO_SYNTHESIZE:
        print(f'[发送文本]: {text_chunk}')
        qwen_tts_realtime.append_text(text_chunk)
        time.sleep(0.1)

    qwen_tts_realtime.finish()
    callback.wait_for_finished()

    print(f'[Metric] session_id={qwen_tts_realtime.get_session_id()}, '
          f'first_audio_delay={qwen_tts_realtime.get_first_audio_delay()}s')
```
声音复刻服务不提供预览音频，需通过语音合成接口试听并评估效果。建议使用简短文本进行初次测试。

以下示例演示了如何在语音合成中使用声音复刻生成的专属音色，实现与原音高度相似的输出效果。这里参考了使用系统音色进行语音合成DashScope SDK的“server commit模式”示例代码，将voice参数替换为复刻生成的专属音色进行语音合成。

关键原则：声音复刻时使用的模型 (target_model) 必须与后续进行语音合成时使用的模型 (model) 保持一致，否则会导致合成失败。

示例使用本地音频文件 voice.mp3 进行声音复刻，运行代码时，请注意替换。

### server_commit 模式
将session.update事件的session.mode 设为"server_commit"以启用该模式，服务端会智能处理文本分段和合成时机。

交互流程如下：

客户端发送session.update事件，服务端响应session.created与session.updated事件。

客户端发送 input_text_buffer.append 事件追加文本至服务端缓冲区。

服务端智能处理文本分段和合成时机，并返回response.created、response.output_item.added、response.content_part.added、response.audio.delta事件。

服务端响应完成后响应response.audio.done、response.content_part.done、response.output_item.done、response.done。

服务端响应session.finished来结束会话。

生命周期

客户端事件

服务器事件

会话初始化

session.update

会话配置
session.created

会话已创建
session.updated

会话配置已更新
用户文本输入

input_text_buffer.append

添加文本到服务端
input_text_buffer.commit

立即合成服务端缓存的文本
session.finish

通知服务端不再有文本输入
input_text_buffer.committed

服务端收到提交的文本
服务器音频输出

无

response.created

服务端开始生成响应
response.output_item.added

响应时有新的输出内容
response.content_part.added

新的输出内容添加到assistant message
response.audio.delta

模型增量生成的音频
response.content_part.done

Assistant message 的文本或音频内容流式输出完成
response.output_item.done

Assistant message 的整个输出项流式传输完成
response.audio.done

音频生成完成
response.done

响应完成
### commit 模式
将session.update事件的session.mode 设为"commit"以启用该模式，客户端需主动提交文本缓冲区至服务端来获取响应。

交互流程如下：

客户端发送session.update事件，服务端响应session.created与session.updated事件。

客户端发送 input_text_buffer.append 事件追加文本至服务端缓冲区。

客户端发送input_text_buffer.commit事件将缓冲区提交至服务端，并发送 session.finish事件表示后续无文本输入。

服务端响应response.created，开始生成响应。

服务端响应response.output_item.added、response.content_part.added、response.audio.delta事件。

服务端响应完成后返回response.audio.done、response.content_part.done、response.output_item.done、response.done。

服务端响应session.finished来结束会话。

生命周期

客户端事件

服务器事件

会话初始化

session.update

会话配置
session.created

会话已创建
session.updated

会话配置已更新
用户文本输入

input_text_buffer.append

添加文本到缓冲区
input_text_buffer.commit

提交缓冲区到服务端
input_text_buffer.clear

清除缓冲区
input_text_buffer.committed

服务器收到提交的文本
服务器音频输出

无

response.created

服务端开始生成响应
response.output_item.added

响应时有新的输出内容
response.content_part.added

新的输出内容添加到assistant message
response.audio.delta

模型增量生成的音频
response.content_part.done

Assistant message 的文本或音频内容流式输出完成
response.output_item.done

Assistant message 的整个输出项流式传输完成
response.audio.done

音频生成完成
response.done

响应完成

### 将 llm 生成的文本实时语音合成
```python
# coding=utf-8
# Installation instructions for pyaudio:
# APPLE Mac OS X
#   brew install portaudio
#   pip install pyaudio
# Debian/Ubuntu
#   sudo apt-get install python-pyaudio python3-pyaudio
#   or
#   pip install pyaudio
# CentOS
#   sudo yum install -y portaudio portaudio-devel && pip install pyaudio
# Microsoft Windows
#   python -m pip install pyaudio

import pyaudio
import dashscope
from dashscope.audio.tts_v2 import *


from http import HTTPStatus
from dashscope import Generation

# 若没有将API Key配置到环境变量中，需将下面这行代码注释放开，并将apiKey替换为自己的API Key
# dashscope.api_key = "apiKey"

# 不同模型版本需要使用对应版本的音色：
# cosyvoice-v3-flash/cosyvoice-v3-plus：使用longanyang等音色。
# cosyvoice-v2：使用longxiaochun_v2等音色。
model = "cosyvoice-v3-flash"
voice = "longanyang"


class Callback(ResultCallback):
    _player = None
    _stream = None

    def on_open(self):
        print("websocket is open.")
        self._player = pyaudio.PyAudio()
        self._stream = self._player.open(
            format=pyaudio.paInt16, channels=1, rate=22050, output=True
        )

    def on_complete(self):
        print("speech synthesis task complete successfully.")

    def on_error(self, message: str):
        print(f"speech synthesis task failed, {message}")

    def on_close(self):
        print("websocket is closed.")
        # stop player
        self._stream.stop_stream()
        self._stream.close()
        self._player.terminate()

    def on_event(self, message):
        print(f"recv speech synthsis message {message}")

    def on_data(self, data: bytes) -> None:
        print("audio result length:", len(data))
        self._stream.write(data)


def synthesizer_with_llm():
    callback = Callback()
    synthesizer = SpeechSynthesizer(
        model=model,
        voice=voice,
        format=AudioFormat.PCM_22050HZ_MONO_16BIT,
        callback=callback,
    )

    messages = [{"role": "user", "content": "请介绍一下你自己"}]
    responses = Generation.call(
        model="qwen-turbo",
        messages=messages,
        result_format="message",  # set result format as 'message'
        stream=True,  # enable stream output
        incremental_output=True,  # enable incremental output 
    )
    for response in responses:
        if response.status_code == HTTPStatus.OK:
            print(response.output.choices[0]["message"]["content"], end="")
            synthesizer.streaming_call(response.output.choices[0]["message"]["content"])
        else:
            print(
                "Request id: %s, Status code: %s, error code: %s, error message: %s"
                % (
                    response.request_id,
                    response.status_code,
                    response.code,
                    response.message,
                )
            )
    synthesizer.streaming_complete()
    print('requestId: ', synthesizer.get_last_request_id())


if __name__ == "__main__":
    synthesizer_with_llm()
```

## 图生视频-基于首帧
```python
import os
from http import HTTPStatus
from dashscope import VideoSynthesis
import dashscope

# 以下为北京地域URL，各地域的URL不同，获取URL：https://help.aliyun.com/zh/model-studio/image-to-video-api-reference
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
api_key = os.getenv("DASHSCOPE_API_KEY", "YOUR_API_KEY")

print('please wait...')
rsp = VideoSynthesis.call(api_key=api_key,
                          model='wan2.6-i2v-flash',
                          prompt='镜头从海龟下方缓缓上移，海龟悠然游动，腹部细节清晰可见。',
                          img_url="https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260121/zlpocv/wan-i2v-haigui.webp",
                          resolution="720P",
                          duration=10,
                          shot_type="multi",
                          prompt_extend=True,
                          watermark=True)
print(rsp)
if rsp.status_code == HTTPStatus.OK:
    print("video_url:", rsp.output.video_url)
else:
    print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message))
```

- 输出示例
```json
{
    "request_id": "c1209113-8437-424f-a386-xxxxxx",
    "output": {
        "task_id": "966cebcd-dedc-4962-af88-xxxxxx",
        "task_status": "SUCCEEDED",
        "video_url": "https://dashscope-result-sh.oss-accelerate.aliyuncs.com/xxx.mp4?Expires=xxx",
         ...
    },
    ...
}
```
模型名称

能力支持

输入模态

输出视频规格

wan2.6-i2v-flash 推荐

有声视频、无声视频

多镜头叙事、声画同步

文本、图像、音频

分辨率档位：720P、1080P

视频时长：[2s, 15s]（整数）

固定规格：30fps、MP4 (H.264编码)

---

wan2.6-i2v 推荐

有声视频

多镜头叙事、声画同步

文本、图像、音频

分辨率档位：720P、1080P

视频时长：[2s, 15s]（整数）

固定规格：30fps、MP4 (H.264编码)

---

支持模型：wan2.6-i2v-flash、wan2.2系列模型、wanx2.1系列模型。

功能介绍：适用于无需音频的纯视觉展示场景，如动态海报、无声短视频等。

参数设置：

wan2.6-i2v-flash：默认生成有声视频。若需生成无声视频，必须显式设置 audio=false。即使传入 audio_url，只要 audio=false，输出仍为无声视频，并按无声视频计费。

wan2.2及以下版本模型：默认生成无声视频，无需额外配置。

```python
import os
from http import HTTPStatus
from dashscope import VideoSynthesis
import dashscope

# 以下为北京地域URL，各地域的URL不同，获取URL：https://help.aliyun.com/zh/model-studio/image-to-video-api-reference
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

# 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
api_key = os.getenv("DASHSCOPE_API_KEY")

def sample_async_call_i2v():
    # 异步调用，返回一个task_id
    rsp = VideoSynthesis.async_call(api_key=api_key,
                                    model='wan2.6-i2v-flash',
                                    prompt='一只猫在草地上奔跑',
                                    img_url="https://cdn.translate.alibaba.com/r/wanx-demo-1.png",
                                    audio=False,   # 必须显式设置为False，表示输出无声视频
                                    resolution="720P",
                                    duration=5,
                                    prompt_extend=True,
                                    watermark=True,
                                    negative_prompt="",
                                    seed=12345)
    print(rsp)
    if rsp.status_code == HTTPStatus.OK:
        print("task_id: %s" % rsp.output.task_id)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message))

    # 等待异步任务结束
    rsp = VideoSynthesis.wait(task=rsp, api_key=api_key)
    print(rsp)
    if rsp.status_code == HTTPStatus.OK:
        print(rsp.output.video_url)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message))


if __name__ == '__main__':
    sample_async_call_i2v()
```
传入图像
图像个数：1个。

输入方式：图像URL、本地文件路径、Base64 编码字符串。
公网URL：支持 HTTP 或 HTTPS 协议。

示例值：https://help-static-aliyun-doc.aliyuncs.com/xxx.png。

临时URL：支持OSS协议，必须通过上传文件获取临时 URL。

示例值：oss://dashscope-instant/xxx/xxx.png。

示例值：data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABDg......（示例已截断，仅做演示）。

格式要求：遵循 data:{MIME_type};base64,{base64_data} 的格式，其中：

{base64_data}：图像文件经过 Base64 编码后的字符串。

{MIME_type}：图像的媒体类型，需与文件格式对应。

图像格式

MIME Type

JPEG

image/jpeg

JPG

image/jpeg

PNG

image/png

BMP

image/bmp

WEBP

image/webp

```python
import base64
import os
from http import HTTPStatus
from dashscope import VideoSynthesis
import mimetypes
import dashscope

# 以下为北京地域url，获取url：https://help.aliyun.com/zh/model-studio/image-to-video-api-reference
dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

# 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
# 获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
api_key = os.getenv("DASHSCOPE_API_KEY")

# --- 辅助函数：用于 Base64 编码 ---
# 格式为 data:{MIME_type};base64,{base64_data}
def encode_file(file_path):
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type or not mime_type.startswith("image/"):
        raise ValueError("不支持或无法识别的图像格式")
    with open(file_path, "rb") as image_file:
        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
    return f"data:{mime_type};base64,{encoded_string}"

"""
图像输入方式说明：
以下提供了三种图片输入方式，三选一即可

1. 使用公网URL - 适合已有公开可访问的图片
2. 使用本地文件 - 适合本地开发测试
3. 使用Base64编码 - 适合私有图片或需要加密传输的场景
"""

# 【方式一】使用公网可访问的图片URL
# 示例：使用一个公开的图片URL
img_url = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/wpimhv/rap.png"

# 【方式二】使用本地文件（支持绝对路径和相对路径）
# 格式要求：file:// + 文件路径
# 示例（绝对路径）：
# img_url = "file://" + "/path/to/your/img.png"    # Linux/macOS
# img_url = "file://" + "/C:/path/to/your/img.png"  # Windows
# 示例（相对路径）：
# img_url = "file://" + "./img.png"                # 相对当前执行文件的路径

# 【方式三】使用Base64编码的图片
# img_url = encode_file("./img.png")

# 设置音频audio url
audio_url = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/ozwpvi/rap.mp3"

def sample_call_i2v():
    # 同步调用，直接返回结果
    print('please wait...')
    rsp = VideoSynthesis.call(api_key=api_key,
                              model='wan2.6-i2v-flash',
                              prompt='一幅都市奇幻艺术的场景。一个充满动感的涂鸦艺术角色。一个由喷漆所画成的少年，正从一面混凝土墙上活过来。他一边用极快的语速演唱一首英文rap，一边摆着一个经典的、充满活力的说唱歌手姿势。场景设定在夜晚一个充满都市感的铁路桥下。灯光来自一盏孤零零的街灯，营造出电影般的氛围，充满高能量和惊人的细节。视频的音频部分完全由他的rap构成，没有其他对话或杂音。',
                              img_url=img_url,
                              audio_url=audio_url,
                              resolution="720P",
                              duration=10,
                              prompt_extend=True,
                              watermark=False,
                              negative_prompt="",
                              seed=12345)
    print(rsp)
    if rsp.status_code == HTTPStatus.OK:
        print("video_url:", rsp.output.video_url)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' %
              (rsp.status_code, rsp.code, rsp.message))


if __name__ == '__main__':
    sample_call_i2v()
```

视频个数：1个。

输出视频规格：不同模型支持的输出规格有所差异，请参见适用范围。

输出视频URL有效期：24小时。

输出视频尺寸：由输入图像和设置的分辨率resolution决定。

模型将尽量保持输入图像的宽高比不变，缩放至总像素数接近目标值。因编码规范，长宽必须被16整除，模型会自动微调尺寸。

例如：输入图像750×1000（宽高比 3:4 = 0.75），设置 resolution = "720P"（目标总像素约 92 万）。最终输出可能为 816 × 1104（宽高比 ≈ 0.739，总像素 ≈ 90 万），且长宽均为 16 的倍数。

我们需要自己下载并报错到 oss

常见问题
Q: 为什么不能直接设置视频宽高比（如 16:9）？
A：当前 API 不支持直接指定视频宽高比。您只能通过 resolution 参数设置视频的分辨率。

resolution 控制的是视频的总像素数量，而非固定比例。模型会优先保留输入首帧图像的原始宽高比（近似），并在此基础上进行微调，以满足视频编码要求（即长和宽均需为 16 的整数倍）。

Q: 为什么运行SDK代码时出现 “url error, please check url!” 错误？
A：请确保：

DashScope Python SDK 版本不低于 1.25.8。

DashScope Java SDK 版本不低于 2.22.6。