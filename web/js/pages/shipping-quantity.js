(function () {
  var params = new URLSearchParams(location.search);
  var instructionId = params.get('id');
  var currentLine = null;
  var linesCache = [];
  var html5Qr = null;

  function api(path, opts) { return fetch('/api' + path, opts).then(function (r) {
    return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
  }); }

  function loadHead() {
    api('/shipping-instructions/' + instructionId).then(function (r) {
      var d = r.body || {};
      document.getElementById('instruction-head').innerHTML =
        '<div class="d-flex justify-content-between flex-wrap">' +
        '<div><div class="h5 mb-0">出荷指示 ' + (d.instruction_id || instructionId) + '</div>' +
        '<div class="text-muted small">' + (d.customer_name || '') + ' / 出荷日 ' + (d.shipping_date ? d.shipping_date.substring(0,10) : '-') + '</div></div>' +
        '<span class="status-badge badge-pending align-self-center">' + (d.status || '') + '</span></div>';
    });
  }

  function loadLines() {
    return api('/shipping-instructions/' + instructionId + '/lines').then(function (r) {
      var lines = r.body || [];
      linesCache = lines;
      var box = document.getElementById('lines');
      if (!lines.length) { box.innerHTML = '<div class="text-muted">明細がありません</div>'; return; }
      box.innerHTML = lines.map(function (l) {
        var pct = l.quantity ? Math.round(l.shipped_quantity / l.quantity * 100) : 0;
        var cls = l.status === 'completed' ? 'completed' : (l.status === 'partial' ? 'partial' : '');
        var statusLabel = l.status === 'completed' ? '数量確定' : (l.status === 'partial' ? '一部確定' : '未確定');
        return '<div class="app-card line-card p-3 mb-2 ' + cls + '" data-line=\'' + JSON.stringify(l) + '\'>' +
          '<div class="d-flex justify-content-between"><strong>' + l.product_name + '</strong>' +
          '<span class="badge ' + (l.status==='completed'?'badge-ok':l.status==='partial'?'badge-pending':'bg-secondary') + '">' + statusLabel + '</span></div>' +
          '<div class="small text-muted">' + l.product_code + '</div>' +
          '<div class="d-flex justify-content-between small mt-1"><span>出荷 ' + l.shipped_quantity + ' / 指示 ' + l.quantity + '</span><span>残 ' + l.remaining_quantity + '</span></div>' +
            '<div class="progress mt-1"><div class="progress-bar" data-progress-width="' + pct + '"></div></div>' +
          (l.shipped_quantity === 0 ? '<div class="text-end mt-1"><button class="btn btn-outline-danger btn-sm py-0" data-del-line="' + l.id + '"><i class="fas fa-trash"></i></button></div>' : '') +
          '</div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('[data-progress-width]'), function (bar) {
          bar.style.width = bar.getAttribute('data-progress-width') + '%';
        });
        Array.prototype.forEach.call(box.querySelectorAll('.line-card'), function (el) {
        el.addEventListener('click', function (ev) {
          if (ev.target.closest('[data-del-line]')) return;
          box.querySelectorAll('.line-card').forEach(function (x){x.classList.remove('active');});
          el.classList.add('active');
          selectLine(JSON.parse(el.getAttribute('data-line')));
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-del-line]'), function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (!confirm('この明細を削除しますか?')) return;
          api('/shipping-instructions/lines/' + b.getAttribute('data-del-line'), { method: 'DELETE' })
            .then(function (r) {
              if (!r.ok) { if (window.showToast) showToast((r.body && r.body.error) || '削除できません', 'ng'); return; }
              if (window.showToast) showToast('明細を削除しました', 'ok');
              document.getElementById('lot-panel').classList.add('d-none');
              document.getElementById('lot-empty').classList.remove('d-none');
              currentLine = null; loadLines();
              renderWorkflow();
            });
        });
      });
      renderWorkflow();
      return lines;
    });
  }

  function renderWorkflow() {
    var panel = document.getElementById('workflow-panel');
    if (!linesCache.length) {
      panel.classList.add('d-none');
      return;
    }
    var completed = linesCache.filter(function (l) { return l.status === 'completed'; }).length;
    var next = getNextIncompleteLine();
    var total = linesCache.length;
    panel.classList.remove('d-none', 'done');
    if (next) {
      panel.innerHTML =
        '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div><div class="fw-semibold"><i class="fas fa-list-check me-1"></i>数量確定 ' + completed + ' / ' + total + ' 品目</div>' +
          '<div class="small text-muted">未確定品目を選択し、適正ロットと出荷数を入力してください。</div></div>' +
          '<button class="btn btn-primary" type="button" id="btn-next-line"><i class="fas fa-arrow-right me-1"></i>次の未確定品目</button>' +
        '</div>';
      document.getElementById('btn-next-line').addEventListener('click', function () { selectLineAndMark(next); });
    } else {
      panel.classList.add('done');
      panel.innerHTML =
        '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div><div class="fw-semibold text-success"><i class="fas fa-check-circle me-1"></i>全品目の数量が確定しました</div>' +
          '<div class="small text-muted">次は出荷作業(PPS フロー)へ進みます。</div></div>' +
          '<a class="btn btn-success btn-field" href="pps.html?id=' + encodeURIComponent(instructionId) + '">' +
            '<i class="fas fa-boxes me-1"></i>出荷作業へ進む</a>' +
        '</div>';
    }
  }

  function getNextIncompleteLine(exceptLineId) {
    return linesCache.find(function (l) {
      return l.status !== 'completed' && l.id !== exceptLineId;
    }) || null;
  }

  function selectLineAndMark(line) {
    var box = document.getElementById('lines');
    box.querySelectorAll('.line-card').forEach(function (x) {
      x.classList.toggle('active', JSON.parse(x.getAttribute('data-line')).id === line.id);
    });
    selectLine(line);
  }

  // 製品選択肢を読み込み
  function loadProductOptions() {
    api('/products').then(function (r) {
      var sel = document.getElementById('add-product');
      (r.body || []).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.id; o.textContent = p.product_code + ' ' + p.product_name;
        sel.appendChild(o);
      });
    });
  }

  function addLine() {
    var pid = document.getElementById('add-product').value;
    var qty = parseInt(document.getElementById('add-qty').value, 10);
    var msg = document.getElementById('add-line-msg');
    if (!pid || !qty || qty <= 0) { msg.className='small mt-1 text-danger'; msg.textContent='製品と正の指示数を入力してください'; return; }
    api('/shipping-instructions/' + instructionId + '/lines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: parseInt(pid,10), quantity: qty })
    }).then(function (r) {
      if (!r.ok) { msg.className='small mt-1 text-danger'; msg.textContent=(r.body && r.body.error) || '追加に失敗しました'; return; }
      msg.className='small mt-1 text-success'; msg.textContent='明細を追加しました';
      document.getElementById('add-product').value=''; document.getElementById('add-qty').value='';
      loadLines();
    });
  }

  function selectLine(line) {
    currentLine = line;
    document.getElementById('lot-empty').classList.add('d-none');
    document.getElementById('lot-panel').classList.remove('d-none');
    document.getElementById('panel-product').textContent = line.product_name;
    document.getElementById('lot-number').value = '';
    document.getElementById('ship-qty').value = '';
    document.getElementById('alloc-msg').textContent = '';
    loadLots(); loadAllocations();
  }

  function loadLots() {
    api('/shipping-instruction-lines/' + currentLine.id + '/lots').then(function (r) {
      var lots = r.body || [];
      document.getElementById('lots-body').innerHTML = lots.length ? lots.map(function (lt) {
        return '<tr class="lot-row" data-lot="' + lt.lot_number + '"><td>' + lt.lot_number + '</td>' +
          '<td class="text-end">' + lt.quantity + '</td><td>' + (lt.location||'') + '</td>' +
          '<td>' + (lt.expiry_date ? lt.expiry_date.substring(0,10) : '-') + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="text-muted">出荷可能なロットがありません</td></tr>';
      Array.prototype.forEach.call(document.querySelectorAll('#lots-body .lot-row'), function (tr) {
        tr.addEventListener('click', function () {
          document.getElementById('lot-number').value = tr.getAttribute('data-lot');
          document.getElementById('ship-qty').focus();
        });
      });
    });
  }

  function loadAllocations() {
    api('/shipping-instruction-lines/' + currentLine.id + '/allocations').then(function (r) {
      var al = r.body || [];
      document.getElementById('alloc-body').innerHTML = al.length ? al.map(function (a) {
        return '<tr><td>' + a.lot_number + '</td><td class="text-end">' + a.shipped_quantity + '</td>' +
          '<td>' + (a.operator_name||'') + '</td><td class="small">' + new Date(a.scanned_at).toLocaleString('ja-JP') + '</td>' +
          '<td><button class="btn btn-outline-danger btn-sm" data-cancel="' + a.id + '">取消</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="text-muted">まだありません</td></tr>';
      Array.prototype.forEach.call(document.querySelectorAll('[data-cancel]'), function (b) {
        b.addEventListener('click', function () {
          if (!confirm('この割り当てを取り消しますか?(在庫を戻します)')) return;
          api('/shipping-instruction-lines/allocations/' + b.getAttribute('data-cancel'), { method: 'DELETE' })
            .then(function () { refresh(); });
        });
      });
    });
  }

  function allocate() {
    var lot = document.getElementById('lot-number').value.trim();
    var qty = parseInt(document.getElementById('ship-qty').value, 10);
    var msg = document.getElementById('alloc-msg');
    if (!lot || !qty || qty <= 0) { msg.className='small mt-2 text-danger'; msg.textContent='ロット番号と正の出荷数を入力してください'; return; }
    var operator = (window.getInspector && getInspector()) ? getInspector().name : '';
    api('/shipping-instruction-lines/' + currentLine.id + '/allocate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_number: lot, shipped_quantity: qty, operator_name: operator })
    }).then(function (r) {
      if (!r.ok) { msg.className='small mt-2 text-danger'; msg.textContent = (r.body && r.body.error) || '割り当てに失敗しました'; return; }
      msg.className='small mt-2 text-success';
      msg.textContent = 'ロット ' + lot + ' から ' + qty + ' を出荷割り当てしました(残 ' + r.body.line.remaining_quantity + ')';
      if (window.showToast) showToast('出荷数を割り当てました', 'ok');
      document.getElementById('lot-number').value=''; document.getElementById('ship-qty').value='';
      refreshAfterAllocation(r.body.line);
    });
  }

  function refreshAfterAllocation(updatedLine) {
    loadLines().then(function (lines) {
      var current = (lines || []).find(function (x) { return x.id === updatedLine.id; });
      var next = getNextIncompleteLine(updatedLine.status === 'completed' ? updatedLine.id : null);
      if (updatedLine.status !== 'completed' && current) {
        currentLine = current;
        loadLots();
        loadAllocations();
        document.getElementById('ship-qty').focus();
        return;
      }
      if (next) {
        if (window.showToast) showToast('次の未確定品目を選択しました: ' + next.product_name, 'info');
        selectLineAndMark(next);
        document.getElementById('lot-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      currentLine = null;
      document.getElementById('lot-panel').classList.add('d-none');
      document.getElementById('lot-empty').classList.remove('d-none');
      renderWorkflow();
      if (window.showToast) showToast('全品目の数量が確定しました。出荷作業へ進めます。', 'ok');
    });
  }

  function refresh() {
    var id = currentLine ? currentLine.id : null;
    loadLines();
    if (id) {
      api('/shipping-instructions/' + instructionId + '/lines').then(function (r) {
        var ln = (r.body||[]).filter(function (x){return x.id===id;})[0];
        if (ln) { currentLine = ln; loadLots(); loadAllocations(); }
        renderWorkflow();
      });
    }
  }

  // QR スキャン(html5-qrcode)
  document.getElementById('btn-scan').addEventListener('click', function () {
    var el = document.getElementById('qr-reader');
    if (!el.classList.contains('d-none')) { stopScan(); return; }
    el.classList.remove('d-none');
    html5Qr = new Html5Qrcode('qr-reader');
    html5Qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 200 }, function (text) {
      // QR に含まれるロット番号を抽出(URLやテキストからそれらしい値を拾う)
      var m = text.match(/(LOT[-_A-Za-z0-9]+)/i);
      document.getElementById('lot-number').value = m ? m[1] : text;
      if (window.showToast) showToast('ロット読取: ' + document.getElementById('lot-number').value, 'info');
      stopScan();
      document.getElementById('ship-qty').focus();
    }, function () {}).catch(function () {
      document.getElementById('alloc-msg').className='small mt-2 text-danger';
      document.getElementById('alloc-msg').textContent='カメラを起動できませんでした';
      el.classList.add('d-none');
    });
  });
  function stopScan() {
    var el = document.getElementById('qr-reader');
    if (html5Qr) { html5Qr.stop().then(function(){ html5Qr.clear(); }).catch(function(){}); html5Qr = null; }
    el.classList.add('d-none');
  }
  document.getElementById('btn-allocate').addEventListener('click', allocate);
  document.getElementById('btn-add-line').addEventListener('click', addLine);

  if (!instructionId) {
    document.getElementById('instruction-head').innerHTML = '<div class="text-danger">出荷指示IDが指定されていません(?id=)</div>';
  } else { loadHead(); loadLines(); loadProductOptions(); }
})();
