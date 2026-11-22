import { formatMoneyWhole } from '../data/balance';
import { CHEATS, CheatCategoryId, CheatDef, CheatNodeDef } from '../data/cheats';
import { store } from '../state/store';

export function formatTipHtml(raw: string): string {
  return raw
    .replace(/<head>(.*?)<\/head>/g, '<span class="kw-head">$1</span>')
    .replace(/<pay>(.*?)<\/pay>/g, '<span class="kw-pay">$1</span>')
    .replace(/<green>(.*?)<\/green>/g, '<span class="kw-green">$1</span>')
    .replace(/<red>(.*?)<\/red>/g, '<span class="kw-red">$1</span>')
    .replace(/<gold>(.*?)<\/gold>/g, '<span class="kw-gold">$1</span>')
    .replace(/<rainbow>(.*?)<\/rainbow>/g, '<span class="kw-rainbow">$1</span>')
    .replace(/<bank>(.*?)<\/bank>/g, '<span class="kw-bank">$1</span>')
    .replace(/<heat>(.*?)<\/heat>/g, '<span class="kw-heat">$1</span>');
}

const FAKE_BUYERS = ['xX_Kev1n_Xx', 'SniperGod99', 'BhopKing', 'NoScopeTim', 'HaxLina', 'AimWizard', 'WallbangWilli'];

export function renderCheatShop(
  container: HTMLElement,
  selectedTab: string,
  onSelectTab: (tab: string) => void,
  onOpenLoader: () => void,
): void {
  const tabs: { id: string; label: string }[] = [
    { id: 'all', label: 'ALLE (12)' },
    { id: 'aim', label: 'AIM' },
    { id: 'visuals', label: 'VISUALS' },
    { id: 'movement', label: 'MOVEMENT' },
    { id: 'weapons', label: 'WEAPONS' },
    { id: 'stealth', label: 'ANTI-CHEAT' },
    { id: 'rage', label: 'RAGE' },
  ];

  const visibleCheats = selectedTab === 'all' ? CHEATS : CHEATS.filter((c) => c.tab === selectedTab);
  const tickerText = FAKE_BUYERS.map((b, i) => `${b} kaufte gerade ${CHEATS[i % CHEATS.length].name}`).join('   ★   ') +
    '   ★   CODE "NOBAN" FÜR 0% RABATT   ★   SEIT 9000 TAGEN UNDETECTED*';

  container.innerHTML = `
    <div class="hax-site">
      <div class="hax-header">
        <div>
          <div class="hax-logo">0DAY-HAX.NET <span class="hax-badge-blink">UNDETECTED</span></div>
          <div class="hax-tag">#1 undetected cheats since 2003 :: anti-cheat? never heard of it</div>
        </div>
        <div class="hax-header-right">
          <div class="hax-wallet">GUTHABEN: <strong>${formatMoneyWhole(store.data.credits)}</strong></div>
          <button class="os-btn small" id="hax-open-loader">INJECTOR.EXE &gt;&gt;</button>
        </div>
      </div>
      <div class="hax-marquee"><span>${tickerText}</span></div>
      <div class="hax-tabs">
        ${tabs.map((t) => `<button class="hax-tab ${t.id === selectedTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        <span class="hax-legend">
          <span class="leg owned">■ Installiert</span>
          <span class="leg buy">■ Kaufbar</span>
          <span class="leg poor">■ Zu teuer</span>
          <span class="leg locked">■ Gesperrt</span>
        </span>
      </div>
      <div class="hax-trees-scroll" id="hax-trees-scroll">
        <div class="hax-trees-grid" id="hax-trees-grid"></div>
      </div>
      <div class="hax-tooltip hidden" id="hax-tooltip"></div>
    </div>
  `;

  container.querySelector('#hax-open-loader')!.addEventListener('click', onOpenLoader);
  container.querySelectorAll<HTMLButtonElement>('.hax-tab').forEach((btn) => {
    btn.addEventListener('click', () => onSelectTab(btn.dataset.tab!));
  });

  const grid = container.querySelector('#hax-trees-grid') as HTMLDivElement;
  const tooltip = container.querySelector('#hax-tooltip') as HTMLDivElement;

  const showTip = (html: string, ev: MouseEvent) => {
    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    moveTip(ev);
  };
  const moveTip = (ev: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const x = Math.min(rect.width - 270, Math.max(8, ev.clientX - rect.left + 14));
    const y = Math.min(rect.height - 140, Math.max(8, ev.clientY - rect.top + 14));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  const hideTip = () => tooltip.classList.add('hidden');

  for (const cheat of visibleCheats) {
    grid.appendChild(buildCheatCard(cheat, showTip, moveTip, hideTip));
  }
}

function buildCheatCard(
  cheat: CheatDef,
  showTip: (html: string, ev: MouseEvent) => void,
  moveTip: (ev: MouseEvent) => void,
  hideTip: () => void,
): HTMLElement {
  const owned = store.ownsCheat(cheat.id);
  const boughtCount = store.data.cheats[cheat.id]?.boughtNodes.length ?? 0;
  const canAffordLic = store.canAfford(cheat.licenseCost);

  const card = document.createElement('div');
  card.className = `cheat-tree-card ${owned ? 'owned' : ''}`;
  card.style.setProperty('--cheat-color', cheat.color);

  // Compute layout positions in card SVG/node coordinate space
  const cols = cheat.nodes.map((n) => n.col);
  const minCol = Math.min(-1, ...cols);
  const maxCol = Math.max(1, ...cols);
  const maxRow = Math.max(1, ...cheat.nodes.map((n) => n.row));
  const colSpan = maxCol - minCol + 1;
  const cellW = 104;
  const cellH = 68;
  const canvasW = Math.max(250, colSpan * cellW + 24);
  const canvasH = (maxRow + 1) * cellH + 20;
  const rootX = canvasW / 2;
  const rootY = 34;

  const nodePos = new Map<string, { x: number; y: number }>();
  nodePos.set('__root__', { x: rootX, y: rootY });
  for (const n of cheat.nodes) {
    const nx = rootX + ((n.col - (minCol + maxCol) / 2) * cellW);
    const ny = rootY + n.row * cellH;
    nodePos.set(n.id, { x: nx, y: ny });
  }

  // Build SVG connector lines
  let svgLines = '';
  for (const n of cheat.nodes) {
    const to = nodePos.get(n.id)!;
    const parentKey = n.requires && !n.requires.includes(':') ? n.requires : '__root__';
    const from = nodePos.get(parentKey) ?? nodePos.get('__root__')!;
    const isBought = store.hasNode(cheat.id, n.id);
    const isUnlocked = store.isNodeUnlocked(n);
    const stroke = n.kind === 'synergy' ? '#c084fc' : isBought ? cheat.color : isUnlocked ? '#64748b' : '#263042';
    const dash = n.kind === 'synergy' ? 'stroke-dasharray="5,4"' : '';
    svgLines += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${isBought ? 3 : 2}" ${dash} />`;
  }

  card.innerHTML = `
    <div class="cheat-card-head">
      <div>
        <span class="cheat-file">${cheat.file}</span>
        <span class="cheat-title" style="color:${cheat.color}">${cheat.name}</span>
      </div>
      <div class="cheat-progress">${owned ? `${boughtCount}/${cheat.nodes.length}` : 'LIZENZ'}</div>
    </div>
    <div class="cheat-tagline">${cheat.tagline}</div>
    <div class="cheat-graph" style="width:${canvasW}px;height:${canvasH}px">
      <svg class="cheat-svg" width="${canvasW}" height="${canvasH}">${svgLines}</svg>
    </div>
  `;

  const graph = card.querySelector('.cheat-graph') as HTMLDivElement;

  // Root license node
  const rootBtn = document.createElement('button');
  const rootState = owned ? 'owned' : canAffordLic ? 'buy' : 'poor';
  rootBtn.className = `tree-node root ${rootState}`;
  rootBtn.style.left = `${rootX}px`;
  rootBtn.style.top = `${rootY}px`;
  rootBtn.innerHTML = `
    <div class="tn-name">${cheat.name}</div>
    <div class="tn-cost">${owned ? '✓ AKTIV' : formatMoneyWhole(cheat.licenseCost)}</div>
  `;
  rootBtn.addEventListener('click', () => {
    if (!owned) store.buyCheatLicense(cheat.id);
  });
  rootBtn.addEventListener('mouseenter', (e) => {
    showTip(
      `<div class="tt-head" style="color:${cheat.color}">${cheat.name} <small>(${cheat.file})</small></div>
       <div class="tt-kind">LIZENZ · ${owned ? 'INSTALLIERT' : formatMoneyWhole(cheat.licenseCost)}</div>
       <div class="tt-body">${formatTipHtml(cheat.tip)}</div>
       <div class="tt-heat">Heat/Kill: ${cheat.heatPerKill > 0 ? `+${cheat.heatPerKill}` : `${cheat.heatPerKill}`}</div>`,
      e,
    );
  });
  rootBtn.addEventListener('mousemove', moveTip);
  rootBtn.addEventListener('mouseleave', hideTip);
  graph.appendChild(rootBtn);

  // Child upgrade / feature / synergy nodes
  for (const node of cheat.nodes) {
    const pos = nodePos.get(node.id)!;
    const isBought = store.hasNode(cheat.id, node.id);
    const isUnlocked = store.isNodeUnlocked(node);
    const canBuy = !isBought && isUnlocked && store.canAfford(node.cost);
    const st = isBought ? 'owned' : canBuy ? 'buy' : isUnlocked ? 'poor' : 'locked';

    const btn = document.createElement('button');
    btn.className = `tree-node ${node.kind} ${st}`;
    btn.style.left = `${pos.x}px`;
    btn.style.top = `${pos.y}px`;
    btn.innerHTML = `
      <div class="tn-name">${node.kind === 'synergy' ? '✦ ' : ''}${node.name}</div>
      <div class="tn-cost">${isBought ? '✓' : formatMoneyWhole(node.cost)}</div>
    `;
    btn.addEventListener('click', () => {
      if (!isBought && isUnlocked) store.buyCheatNode(cheat.id, node.id);
    });
    btn.addEventListener('mouseenter', (e) => {
      const kindLabel = node.kind === 'synergy' ? 'SYNERGIE' : node.kind === 'feature' ? 'NEUES FEATURE' : 'UPGRADE';
      const statHtml = node.before && node.after ? `<div class="tt-stat">${node.before} &raquo; <strong>${node.after}</strong></div>` : '';
      const synNote = node.synergyWith
        ? `<div class="tt-req">Benötigt zusätzlich: ${node.synergyWith.replace(':', ' → ')}</div>`
        : '';
      showTip(
        `<div class="tt-head" style="color:${node.kind === 'synergy' ? '#c084fc' : cheat.color}">${node.name}</div>
         <div class="tt-kind">${kindLabel} · ${isBought ? 'INSTALLIERT' : formatMoneyWhole(node.cost)}</div>
         <div class="tt-body">${formatTipHtml(node.tip)}</div>
         ${statHtml}${synNote}
         ${!isUnlocked && !isBought ? '<div class="tt-lock">🔒 Kaufe zuerst das vorherige Node</div>' : ''}`,
        e,
      );
    });
    btn.addEventListener('mousemove', moveTip);
    btn.addEventListener('mouseleave', hideTip);
    graph.appendChild(btn);
  }

  return card;
}
