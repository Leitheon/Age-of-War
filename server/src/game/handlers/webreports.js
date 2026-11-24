'use strict';
// The web client's Reports window: its filters (the tab's report type, march type, side, unread, flagged, a search
// and a city), flagging a report, marking everything a filter shows as read, and deleting all of it.
// Fox (Nov 2026): its last tab, Automation, is Other (client patch): the Other reports (a city founded, troops
// stationed or sent home, what an opened item gave, the innkeeper's news, charms, policies...) are there, and the
// automation's own battle reports are with the rest, in Army (scouting in Scout).

// The report's content as this client reads it. The server writes the Flash client's XML, every value an attribute
// (<troopUnit typeId="3" count="100" lose="5"/>); this client reads each value from a child element of that name
// (<troopUnit><typeId>3</typeId>...), so below the root each attribute is copied into a child element too. A
// plain-text report (a city founded, what an opened box gave...) becomes a policyReport, whose detail it shows.
const TAG = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+="[^"]*")*)\s*(\/?)>/g, ATTR = /([\w.:-]+)="([^"]*)"/g;
const escText = t => String(t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function webContent(content){
  const s = String(content || '');
  if (!s.trim()) return s;
  if (!s.trimStart().startsWith('<')) return `<reportData><policyReport><detail>${escText(s)}</detail></policyReport></reportData>`;
  let depth = 0;
  return s.replace(TAG, (m, close, name, attrs, self) => {
    if (close){ depth--; return m; }
    const root = depth === 0;
    if (!self) depth++;
    if (root) return m;
    const kids = [...attrs.matchAll(ATTR)].map(([, k, v]) => `<${k}>${v}</${k}>`).join('');
    return self ? `<${name}${attrs}>${kids}</${name}>` : `<${name}${attrs}>${kids}`;
  });
}

module.exports = (game, H) => {
  game.webReportContent = webContent;
  const R = game.reports;
  const num = v => (v === undefined || v === null || v === '' ? -1 : Number(v));
  const matches = (d, web = true) => {
    const type = num(d.reportType), army = num(d.armyType), side = num(d.attack), auto = Number(d.automation) === 1;
    const search = String(d.search || '').trim().toLowerCase(), coord = /^\d+,\d+$/.test(String(d.cityCoord || '')) ? `(${d.cityCoord})` : '';
    return r => (web ? !auto || !!r.automation : auto ? !!r.automation : !r.automation)
      && (type < 0 || r.type === type) && (army < 0 || r.armyType === army) && (side < 0 || !!r.attack === (side === 1))
      && (!Number(d.unreadOnly) || !r.isRead) && (!Number(d.flaggedOnly) || r.isFlagged)
      && (!search || `${r.title} ${r.startPos} ${r.targetPos}`.toLowerCase().includes(search))
      && (!coord || String(r.startPos).includes(coord) || String(r.targetPos).includes(coord));
  };
  const pushCounts = p => game.push(p.id, 'server.NewReport', R.unread(p));

  H['report.receiveReportList'] = (conn, d, cmd) => {
    const p = conn.player, size = Math.max(1, Math.min(50, d.pageSize | 0 || 10));
    const list = R.list(p).filter(matches(d, !!conn.web));
    const total = Math.max(1, Math.ceil(list.length / size)), no = Math.max(1, Math.min(total, d.pageNo | 0 || 1));
    const bean = conn.web ? r => ({ ...R.bean(r), content: webContent(r.content) }) : r => R.bean(r);
    game.reply(conn, cmd, { reports: list.slice((no - 1) * size, no * size).map(bean), pageNo: no, totalPage: total, total: list.length });
  };
  H['report.flagReport'] = (conn, d, cmd) => {
    const r = R.list(conn.player).find(x => x.id === Number(d.reportId));
    if (!r) return game.fail(conn, cmd, -1, 'That report was deleted.');
    if (Number(d.flagged)) r.isFlagged = 1; else delete r.isFlagged;
    game.store.touch(); game.reply(conn, cmd, { reportId: r.id, flagged: r.isFlagged ? 1 : 0 });
  };
  // Delete All: everything the tab and filter show, but flagged reports (as the client says). (The Flash client's
  // deletes a whole report type: reports.js.)
  const deleteType = H['report.deleteAllReports'];
  H['report.deleteAllReports'] = (conn, d, cmd) => {
    if (!conn.web) return deleteType(conn, d, cmd);
    const p = conn.player, shown = matches(d, true), before = R.list(p).length;
    p.reports = R.list(p).filter(r => r.isFlagged || !shown(r));
    game.store.touch(); game.reply(conn, cmd, { deleted: before - p.reports.length }); pushCounts(p);
  };
  H['report.markAllReportsRead'] = (conn, d, cmd) => {
    const p = conn.player; let n = 0;
    for (const r of R.list(p).filter(matches(d, !!conn.web))) if (!r.isRead){ r.isRead = 1; n++; }
    game.store.touch(); game.reply(conn, cmd, { marked: n }); pushCounts(p);
  };
};
