'use strict';
// The web client's Reports window: its filters (the tab's report type, the Automation tab, march type, side,
// unread, flagged, a search and a city), flagging a report, and marking everything a filter shows as read.
module.exports = (game, H) => {
  const R = game.reports;
  const num = v => (v === undefined || v === null || v === '' ? -1 : Number(v));
  const matches = d => {
    const type = num(d.reportType), army = num(d.armyType), side = num(d.attack), auto = Number(d.automation) === 1;
    const search = String(d.search || '').trim().toLowerCase(), coord = /^\d+,\d+$/.test(String(d.cityCoord || '')) ? `(${d.cityCoord})` : '';
    return r => (auto ? !!r.automation : !r.automation)
      && (type < 0 || r.type === type) && (army < 0 || r.armyType === army) && (side < 0 || !!r.attack === (side === 1))
      && (!Number(d.unreadOnly) || !r.isRead) && (!Number(d.flaggedOnly) || r.isFlagged)
      && (!search || `${r.title} ${r.startPos} ${r.targetPos}`.toLowerCase().includes(search))
      && (!coord || String(r.startPos).includes(coord) || String(r.targetPos).includes(coord));
  };
  const pushCounts = p => game.push(p.id, 'server.NewReport', R.unread(p));

  H['report.receiveReportList'] = (conn, d, cmd) => {
    const p = conn.player, size = Math.max(1, Math.min(50, d.pageSize | 0 || 10));
    const list = R.list(p).filter(matches(d));
    const total = Math.max(1, Math.ceil(list.length / size)), no = Math.max(1, Math.min(total, d.pageNo | 0 || 1));
    game.reply(conn, cmd, { reports: list.slice((no - 1) * size, no * size).map(r => R.bean(r)), pageNo: no, totalPage: total, total: list.length });
  };
  H['report.flagReport'] = (conn, d, cmd) => {
    const r = R.list(conn.player).find(x => x.id === Number(d.reportId));
    if (!r) return game.fail(conn, cmd, -1, 'That report was deleted.');
    if (Number(d.flagged)) r.isFlagged = 1; else delete r.isFlagged;
    game.store.touch(); game.reply(conn, cmd, { reportId: r.id, flagged: r.isFlagged ? 1 : 0 });
  };
  H['report.markAllReportsRead'] = (conn, d, cmd) => {
    const p = conn.player; let n = 0;
    for (const r of R.list(p).filter(matches(d))) if (!r.isRead){ r.isRead = 1; n++; }
    game.store.touch(); game.reply(conn, cmd, { marked: n }); pushCounts(p);
  };
};
