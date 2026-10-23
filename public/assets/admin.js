(function () {
  var f = document.querySelector('form[action="/admin/reset"]');
  var d = document.getElementById('rs-dlg');
  if (!f || !d) return;
  var i = document.getElementById('rs-in');
  var ok = document.getElementById('rs-ok');
  var t = document.getElementById('rs-type');

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var all = f.elements.scope.value === 'all';
    t.hidden = !all;
    i.value = '';
    ok.disabled = all;
    d.showModal();
  });
  i.addEventListener('input', function () {
    ok.disabled = i.value !== 'RESET';
  });
  d.addEventListener('close', function () {
    if (d.returnValue === 'yes') f.submit();
  });
})();
