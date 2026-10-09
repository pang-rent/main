'use strict';
(async () => {
  const cfg = window.RENTAL_CONFIG, list = document.querySelector('#lineup .cars'); if (!list) return;
  try {
    const res = await fetch(cfg.api + '/catalog?company=' + encodeURIComponent(cfg.companyId)); if (!res.ok) return;
    const data = await res.json(); if (!data.vehicles.length) return;
    const cards = data.vehicles.map(v => {
      const card = document.createElement('div'); card.className = 'car-card';
      const category = document.createElement('span'); category.className = 'cls'; category.textContent = v.category;
      const name = document.createElement('h3'); name.textContent = v.name;
      const prices = document.createElement('div'); prices.className = 'prices';
      for (const [label, n] of [['월', v.rates.monthly], ['일', v.rates.daily]]) { const part = document.createElement('div'); part.className = 'price'; const small = document.createElement('small'), strong = document.createElement('b'), unit = document.createElement('em'); small.textContent = label; strong.textContent = (n / 10000).toLocaleString('ko-KR'); unit.textContent = '만원'; part.append(small, strong, unit); prices.append(part); }
      const link = document.createElement('a'); link.className = 'btn'; link.style.cssText = 'background:#eef4ff;color:#1d4ed8;margin-top:16px;width:100%;font-size:14px'; link.href = './booking.html?vehicle=' + encodeURIComponent(v.id); link.textContent = '이 차량 선택하기';
      card.append(category, name, prices); if (v.example) { const note = document.createElement('small'); note.textContent = '예시 요금 · 담당자 확인 후 확정'; card.append(note); } card.append(link); return card;
    }); list.replaceChildren(...cards);
    document.getElementById('lineupNotice').textContent = '등록된 차량의 기본요금입니다. 날짜·보험·옵션을 포함한 예상 요금은 직접 선택 화면에서 확인해주세요.';
  } catch {}
})();
