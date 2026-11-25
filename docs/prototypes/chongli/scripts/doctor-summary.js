(function () {
  const form = document.getElementById('ah-query-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    window.atlasDoctorGo('knowledge', form.elements.query.value.trim());
  });
  function refreshSummary() {
    const pending = typeof window.atlasPending === 'function' ? window.atlasPending() : 2;
    document.getElementById('dw-impact').textContent = '已复核 '+(6-pending)+' 份';
    document.getElementById('ah-status').textContent = pending ? pending + ' 条反馈待你复核' : '待复核反馈已处理完毕';
    document.getElementById('ah-review').dataset.clear = String(!pending);
    document.getElementById('ah-review-cta').textContent = pending ? '查看反馈' : '查看记录';
  }
  window.addEventListener('atlas:refresh', refreshSummary);
  document.addEventListener('atlas:refresh', refreshSummary);
  refreshSummary();
})();
