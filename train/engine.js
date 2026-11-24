/**
 * 奕晉體能排課台 — 排課與課表引擎（純函式，不碰網路）
 * ─────────────────────────────────────────────
 * 瀏覽器：<script src="engine.js"> → window.TrainEngine
 * Node 測試：require('./engine.js')
 *
 * 三件事：
 *   1. parseTennisText  把 Adam／網球教練打的備忘錄文字讀成網球課表
 *   2. schedule         依網球時間排體能時段（不撞課、人數上限、派教練）
 *   3. suggestSession   依最近練了什麼＋檢測弱項＋個人狀態，給重／中／輕三種課表
 */
(function (root) {
  'use strict';

  const CFG = {
    open: 8 * 60, close: 20 * 60,              // 場地可用 08:00–20:00
    groups: {
      '大隊': { dur: 90, cap: 12 },
      '小朋友': { dur: 60, cap: 8 }
    },
    breaks: [['12:00', '13:00']],             // 午休不排體能（可在 08 系統設定改）
    minPartial: 30,                           // 至少要有 30 分鐘才算「可以上半堂」
    staleDays: 120,                           // 檢測超過幾天算過期
    spike: 1.3                                // 近 7 天負荷 ÷ 前 4 週週平均 ≥ 1.3 → 負荷暴增
  };

  // ───────────────────────── 時間 ─────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const fmt = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  function toMin(s) {
    const m = String(s || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
    return m ? (+m[1]) * 60 + (+(m[2] || 0)) : NaN;
  }
  const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function weekday(date) { const d = new Date(date + 'T00:00:00'); return WEEK[d.getDay()]; }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
  function addDays(date, n) { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function normDate(v) {
    const m = String(v || '').trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : '';
  }

  // ───────────────────────── 名字對照 ─────────────────────────
  /** roster: [{name, alias:'祐仁,孙祐仁', ...}] → 查表（小寫） */
  function nameIndex(roster) {
    const idx = {};
    (roster || []).forEach(p => {
      [p.name].concat(String(p.alias || '').split(/[,，、;；]+/)).forEach(a => {
        a = String(a || '').trim();
        if (a) idx[a.toLowerCase()] = p.name;
      });
    });
    return idx;
  }

  // ───────────────────────── 1. 讀網球備忘錄 ─────────────────────────
  function convHour(h) { return h >= 1 && h <= 7 ? h + 12 : h; }   // 1-3 → 13-15；7-8 → 19-20

  /**
   * text：Adam 的備忘錄（第一行可有日期）
   * opts.roster：體能名單；opts.coachCodes：網球教練在備忘錄上的稱呼（賴、鄭、javed…）
   * 回 { entries:[{start,end,coaches[],players[],raw}], bad:[原文] }
   */
  function parseTennisText(text, opts) {
    opts = opts || {};
    const idx = nameIndex(opts.roster);
    const codes = (opts.coachCodes || []).map(String).filter(Boolean).sort((a, b) => b.length - a.length);
    const codeSet = new Set(codes.map(c => c.toLowerCase()));
    const dict = Object.keys(idx).filter(k => k.length >= 2 && /^[\u3400-\u9fff]+$/.test(k)).sort((a, b) => b.length - a.length);
    const entries = [], bad = [];

    function splitToken(tok) {
      const low = tok.toLowerCase();
      if (codeSet.has(low)) return [{ coach: tok }];
      if (idx[low]) return [{ name: tok }];
      // 尾巴黏著教練（齐天乐石、孫祐仁賴、小白鄭）
      for (const c of codes) {
        if (low.length > c.length && low.endsWith(c.toLowerCase())) {
          const rest = tok.slice(0, tok.length - c.length);
          return splitToken(rest).concat([{ coach: c }]);
        }
      }
      // 英文名不切（leonard 不是 Leon）
      if (!/^[\u3400-\u9fff]+$/.test(tok)) return [{ name: tok }];
      // 兩個中文名字黏在一起（刘珈妮莫可妍）：用名單裡的名字切
      const out = []; let buf = '', i = 0;
      while (i < tok.length) {
        const hit = dict.find(w => tok.substr(i, w.length).toLowerCase() === w);
        if (hit) { if (buf) { out.push({ name: buf }); buf = ''; } out.push({ name: tok.substr(i, hit.length) }); i += hit.length; }
        else { buf += tok[i]; i++; }
      }
      if (buf) out.push({ name: buf });
      return out;
    }

    String(text || '').split(/\r?\n/).forEach(line => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/^(\d{1,2})(?:[:：](\d{2}))?\s*[-–~～]\s*(\d{1,2})(?:[:：](\d{2}))?\s*[:：]?\s*(.*)$/);
      if (!m) { if (!/^\d{1,2}\/\d{1,2}/.test(raw)) bad.push(raw); return; }
      let s = convHour(+m[1]) * 60 + (+(m[2] || 0));
      let e = convHour(+m[3]) * 60 + (+(m[4] || 0));
      if (e <= s) e += 12 * 60;
      const players = [], coaches = [];
      m[5].split(/[\s,，、]+/).filter(Boolean).forEach(tok => {
        splitToken(tok).forEach(x => {
          if (x.coach) coaches.push(x.coach);
          else if (x.name) players.push(idx[x.name.toLowerCase()] || x.name);
        });
      });
      if (!players.length) { bad.push(raw); return; }
      entries.push({ start: fmt(s), end: fmt(e), coaches, players, raw });
    });
    return { entries, bad };
  }

  // ───────────────────────── 2. 排時段 ─────────────────────────
  /**
   * input = {
   *   date, roster:[{name, group:'大隊'|'小朋友', level, earliest, latest, status, team}],
   *   tennis:[{start,end,players[]}], leave:[name], coaches:[{name,type:'體能',group}],
   *   locked:[{start, group, players[], coaches[]}]  // 教練手動加的課，保留不動
   * }
   * 回 { slots:[...], unplaced:[{name, reason}], notInRoster:[name] }
   */
  function schedule(input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const roster = input.roster || [];
    const byName = {}; roster.forEach(p => byName[p.name] = p);
    const leave = new Set(input.leave || []);
    const busy = {}; const notInRoster = new Set();
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => {
      if (!byName[n]) { notInRoster.add(n); return; }
      (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end)]);
    }));

    const locked = (input.locked || []).map(l => Object.assign({ manual: true }, l));
    const lockedNames = new Set(); locked.forEach(l => (l.players || []).forEach(n => lockedNames.add(n)));

    // 誰今天要排：在訓＋今天有網球＋沒請假＋沒被手動排走
    const todo = roster.filter(p => p.status !== '暫停' && busy[p.name] && !leave.has(p.name) && !lockedNames.has(p.name));

    function info(p) {
      const g = cfg.groups[p.group] || cfg.groups['小朋友'];
      const lo = Math.max(cfg.open, isNaN(toMin(p.earliest)) ? 0 : toMin(p.earliest));
      const hi = Math.min(cfg.close, isNaN(toMin(p.latest)) ? 24 * 60 : toMin(p.latest));
      const tb = (busy[p.name] || []).slice().sort((x, y) => x[0] - y[0]);
      const brk = (cfg.breaks || []).map(x => [toMin(x[0]), toMin(x[1])]);
      const b = tb.concat(brk).sort((x, y) => x[0] - y[0]);       // 網球＋午休都算「不能排」
      const free = t => t >= lo && t + g.dur <= hi && !b.some(x => overlap(t, t + g.dur, x[0], x[1]));
      const cand = {};
      tb.forEach(x => {
        const tA = x[1], tB = x[0] - g.dur;
        if (free(tA)) cand[tA] = '網球 ' + fmt(x[0]) + '–' + fmt(x[1]) + ' 之後接著練';
        if (free(tB)) cand[tB] = '網球 ' + fmt(x[0]) + ' 之前';
      });
      // 沒有完整空檔 → 找最長的相鄰空檔（半堂）
      let partial = null;
      if (!Object.keys(cand).length) {
        b.forEach((x, i) => {
          if (!tb.includes(x)) return;   // 只找網球前後的空檔
          const nextS = i + 1 < b.length ? b[i + 1][0] : hi;
          const prevE = i > 0 ? b[i - 1][1] : lo;
          const after = Math.min(nextS, hi) - x[1];
          const before = x[0] - Math.max(prevE, lo);
          if (after >= cfg.minPartial && (!partial || after > partial.min)) partial = { start: x[1], min: after, why: '網球 ' + fmt(x[1]) + ' 下課到下一堂只有 ' + after + ' 分鐘' };
          if (before >= cfg.minPartial && (!partial || before > partial.min)) partial = { start: x[0] - before, min: before, why: '網球 ' + fmt(x[0]) + ' 前只有 ' + before + ' 分鐘空檔' };
        });
      }
      return { p, g, cand, partial, busy: b };
    }

    const slots = locked.slice();
    const unplaced = [];
    Object.keys(cfg.groups).forEach(group => {
      const g = cfg.groups[group];
      let left = todo.filter(p => (cfg.groups[p.group] ? p.group : '小朋友') === group).map(info);
      // 同一時間最多開幾堂＝這組有幾位體能教練（沒設定教練就不限）
      const nCoach = (input.coaches || []).filter(c => c.type === '體能' && c.group === group).length || 99;
      const open = t => slots.filter(s => s.group === group && overlap(t, t + g.dur, toMin(s.start), toMin(s.end))).length < nCoach;
      while (true) {
        const count = {};
        left.forEach(x => Object.keys(x.cand).forEach(t => count[t] = (count[t] || 0) + 1));
        const times = Object.keys(count).map(Number).filter(open);
        if (!times.length) break;
        times.sort((a, b) => (Math.min(count[b], g.cap) - Math.min(count[a], g.cap)) || (a - b));
        const t = times[0];
        let who = left.filter(x => x.cand[t] !== undefined);
        who.sort((a, b) => Object.keys(a.cand).length - Object.keys(b.cand).length);   // 選擇少的人先上
        who = who.slice(0, g.cap);
        slots.push({ start: fmt(t), end: fmt(t + g.dur), group, players: who.map(x => x.p.name),
          why: Object.fromEntries(who.map(x => [x.p.name, x.cand[t]])), partial: {} });
        const taken = new Set(who.map(x => x.p.name));
        left = left.filter(x => !taken.has(x.p.name));
      }
      // 同一時間開了兩堂以上 → 人數平均分
      const bucket = {};
      slots.filter(s => s.group === group && !s.manual).forEach(s => (bucket[s.start] = bucket[s.start] || []).push(s));
      Object.values(bucket).filter(a => a.length > 1).forEach(a => {
        const all = [].concat(...a.map(s => s.players));
        a.forEach(s => s.players = []);
        all.forEach((n, i) => a[i % a.length].players.push(n));
      });
      // 剩下的：能上半堂就併進同時間的課或開一堂；不行就列為排不進
      left.forEach(x => {
        if (x.partial) {
          const st = x.partial.start;
          let s = slots.find(s => s.group === group && toMin(s.start) <= st && st < toMin(s.end) && s.players.length < g.cap);
          if (!s) { s = { start: fmt(st), end: fmt(st + g.dur), group, players: [], why: {}, partial: {} }; slots.push(s); }
          s.players.push(x.p.name);
          s.why[x.p.name] = x.partial.why;
          s.partial[x.p.name] = Math.min(x.partial.min, toMin(s.end) - st);
        } else {
          unplaced.push({ name: x.p.name, reason: '網球前後都沒有 ' + cfg.minPartial + ' 分鐘以上的空檔' });
        }
      });
    });

    slots.sort((a, b) => toMin(a.start) - toMin(b.start) || a.group.localeCompare(b.group));
    assignCoaches(slots, input.coaches || [], byName, cfg);
    slots.forEach((s, i) => {
      s.id = s.id || ('S' + (i + 1));
      const flags = [];
      if (Object.keys(s.partial || {}).length) flags.push('有人只能上半堂');
      if (s.coachShort) flags.push('教練不夠');
      if (s.players.length > (cfg.groups[s.group] || { cap: 99 }).cap) flags.push('超過人數上限');
      s.flags = flags;
      s.status = flags.length ? (flags.includes('超過人數上限') ? 'bad' : 'warn') : 'ok';
    });
    return { slots, unplaced, notInRoster: Array.from(notInRoster) };
  }

  function levelOf(p) { return p && p.level ? p.level : ''; }

  function assignCoaches(slots, coaches, byName, cfg) {
    const used = {};   // name → [[s,e]]
    const minutes = {};
    slots.forEach(s => {
      const S = toMin(s.start), E = toMin(s.end);
      const g = cfg.groups[s.group] || { cap: 8 };
      const lv = new Set(s.players.map(n => levelOf(byName[n])).filter(Boolean));
      s.needTwo = lv.has('高') && lv.has('低');
      s.needTwoWhy = s.needTwo ? '程度高低都有' : '';
      if (s.manual && s.coaches && s.coaches.length) { s.coaches.forEach(c => (used[c] = used[c] || []).push([S, E])); s._fixed = true; return; }
      s.coaches = [];
    });
    function pick(s) {
      const S = toMin(s.start), E = toMin(s.end);
      const c = coaches.filter(c => c.type === '體能' && c.group === s.group && !s.coaches.includes(c.name))
        .filter(c => !(used[c.name] || []).some(x => overlap(S, E, x[0], x[1])))
        .sort((a, b) => (minutes[a.name] || 0) - (minutes[b.name] || 0))[0];
      if (!c) return false;
      s.coaches.push(c.name); (used[c.name] = used[c.name] || []).push([S, E]); minutes[c.name] = (minutes[c.name] || 0) + (E - S);
      return true;
    }
    // 先每堂一位，再補第二位給程度落差大的
    slots.forEach(s => { if (!s._fixed) s.coachShort = !pick(s); });
    slots.forEach(s => { if (!s._fixed && s.needTwo && !s.coachShort) s.coachShort = !pick(s); delete s._fixed; });
  }

  /** 檢查教練手動拖拉後的版本（不重排，只重算燈號） */
  function recheck(slots, input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const byName = {}; (input.roster || []).forEach(p => byName[p.name] = p);
    const busy = {};
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end), t.start + '–' + t.end])));
    slots.forEach(s => {
      const S = toMin(s.start), E = toMin(s.end);
      s.partial = {}; s.clash = {};
      s.players.forEach(n => {
        const hit = (busy[n] || []).filter(x => overlap(S, E, x[0], x[1]));
        if (!hit.length) return;
        const firstClash = Math.min.apply(null, hit.map(x => x[0]));
        if (firstClash > S) s.partial[n] = firstClash - S;
        else s.clash[n] = '撞到網球 ' + hit[0][2];
      });
      const g = cfg.groups[s.group] || { cap: 99 };
      const flags = [];
      if (Object.keys(s.clash).length) flags.push('撞到網球');
      if (s.players.length > g.cap) flags.push('超過人數上限');
      if (Object.keys(s.partial).length) flags.push('有人只能上半堂');
      if (!s.coaches || !s.coaches.length) flags.push('還沒派教練');
      const lv = new Set(s.players.map(n => levelOf(byName[n])).filter(Boolean));
      if (lv.has('高') && lv.has('低') && (s.coaches || []).length < 2) flags.push('程度落差大，建議兩位教練');
      s.flags = flags;
      s.status = flags.some(f => f === '撞到網球' || f === '超過人數上限') ? 'bad' : (flags.length ? 'warn' : 'ok');
    });
    return slots;
  }

  /**
   * 明天誰可以練：每個人網球前後的空檔
   * 回 { people:[{name, group, tennis:[...], windows:[{start,end,min,where}], best, status}], notIn:[name] }
   *   status：ok＝有完整一堂的空檔、warn＝只有半堂、bad＝沒空檔、leave＝請假
   */
  function availability(input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const roster = input.roster || [];
    const byName = {}; roster.forEach(p => byName[p.name] = p);
    const leave = new Set(input.leave || []);
    const busy = {}, notIn = new Set();
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => {
      if (!byName[n]) { notIn.add(n); return; }
      (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end)]);
    }));
    const brk = (cfg.breaks || []).map(x => [toMin(x[0]), toMin(x[1])]);
    const people = Object.keys(busy).map(n => {
      const p = byName[n];
      const g = cfg.groups[p.group] || cfg.groups['小朋友'];
      const lo = Math.max(cfg.open, isNaN(toMin(p.earliest)) ? 0 : toMin(p.earliest));
      const hi = Math.min(cfg.close, isNaN(toMin(p.latest)) ? 24 * 60 : toMin(p.latest));
      const tb = busy[n].slice().sort((a, b) => a[0] - b[0]);
      const all = tb.concat(brk).sort((a, b) => a[0] - b[0]);
      const wins = [];
      tb.forEach(x => {
        // 之前：往前找到上一個不能排的時間
        const prev = all.filter(y => y[1] <= x[0]).reduce((m, y) => Math.max(m, y[1]), lo);
        const bs = Math.max(prev, lo), be = x[0];
        if (be - bs >= cfg.minPartial) wins.push({ start: fmt(Math.max(bs, be - g.dur)), end: fmt(be), min: Math.min(be - bs, g.dur), where: '網球前' });
        const next = all.filter(y => y[0] >= x[1]).reduce((m, y) => Math.min(m, y[0]), hi);
        const as = x[1], ae = Math.min(next, hi);
        if (ae - as >= cfg.minPartial) wins.push({ start: fmt(as), end: fmt(Math.min(ae, as + g.dur)), min: Math.min(ae - as, g.dur), where: '網球後' });
      });
      const seen = {}; const windows = wins.filter(w => !seen[w.start] && (seen[w.start] = 1)).sort((a, b) => b.min - a.min || toMin(a.start) - toMin(b.start));
      const best = windows[0] || null;
      const status = leave.has(n) ? 'leave' : !best ? 'bad' : best.min >= g.dur ? 'ok' : 'warn';
      return { name: n, group: p.group, team: p.team, unclassified: !!p.unclassified, dur: g.dur,
        tennis: tb.map(x => fmt(x[0]) + '–' + fmt(x[1])), windows: windows.sort((a, b) => toMin(a.start) - toMin(b.start)), best, status };
    });
    const order = { ok: 0, warn: 1, bad: 2, leave: 3 };
    people.sort((a, b) => order[a.status] - order[b.status] || a.group.localeCompare(b.group) || (a.best && b.best ? toMin(a.best.start) - toMin(b.best.start) : 0));
    return { people, notIn: Array.from(notIn) };
  }

  /** 轉成 Adam 平常貼群組的格式 */
  function toChatText(date, slots, leave) {
    const md = date.slice(5).replace(/^0/, '').replace('-0', '-').replace('-', '/');
    const lines = [md + '周' + weekday(date) + ' 體能'];
    slots.forEach(s => {
      const pt = Object.keys(s.partial || {});
      lines.push(s.start + ' ' + s.players.map(n => pt.includes(n) ? n + '(' + s.partial[n] + '分)' : n).join(' ') + (s.coaches && s.coaches.length ? ' ［' + s.coaches.join('+') + '］' : ''));
    });
    if (leave && leave.length) lines.push('請假：' + leave.join(' '));
    return lines.join('\n');
  }

  // ───────────────────────── 3. 這堂練什麼 ─────────────────────────
  const CAT_RULES = [
    ['有氧', /有氧|恢復跑|aerobic/i],
    ['速度', /sprint|衝刺|5-10-5|變向|agility/i],
    ['爆發', /jump|bound|跳|plyo/i],
    ['力量', /squat|deadlift|bench|press|pull|row|thrust|rdl|lunge|蹲|拉|推|划船/i]
  ];
  function category(ex) { for (const [c, re] of CAT_RULES) if (re.test(ex)) return c; return '其他'; }

  const WEAK_ADD = {
    '速度與變向': { name: '5-10-5 變向跑', sets: 4, reps: 1, unit: '趟' },
    '下肢爆發': { name: 'Ecc Broad Jump 離心立定跳遠', sets: 3, reps: 5 },
    '單腿減速': { name: '單腳落地停', sets: 3, reps: 5, unit: '次／邊' },
    '轉體爆發': { name: '藥球轉體拋', sets: 3, reps: 6, unit: '次／邊' },
    '投擲': { name: '藥球過頂拋', sets: 3, reps: 6 },
    '心肺適能': { name: '30-15 間歇跑', sets: 2, reps: 1, unit: '組' }
  };
  const TEMPLATES = {
    '力量': [
      { name: 'Squat 深蹲', sets: 4, reps: 8 }, { name: 'Bulgarian Squat 保加利亞蹲', sets: 3, reps: 8, unit: '次／邊' },
      { name: 'Pull Ups 引體向上', sets: 3, reps: 6 }, { name: 'Hip thrust 臀推', sets: 3, reps: 10 },
      { name: 'SL RDL 單腳RDL', sets: 3, reps: 8, unit: '次／邊' }],
    '速度爆發': [
      { name: 'Sprint 衝刺 10m', sets: 5, reps: 1, unit: '趟' }, { name: 'Skater Jump 滑冰跳', sets: 3, reps: 5, unit: '次／邊' },
      { name: 'SL Box Jump 單腳跳箱', sets: 3, reps: 5, unit: '次／邊' }, { name: 'Band-resisted SJ 彈力帶深蹲跳', sets: 3, reps: 6 },
      { name: 'Side lunge 側弓步', sets: 3, reps: 8, unit: '次／邊' }],
    '小朋友綜合': [
      { name: '敏捷梯＋反應起跑', sets: 4, reps: 1, unit: '趟' }, { name: 'Skater Jump 滑冰跳', sets: 3, reps: 5, unit: '次／邊' },
      { name: '單腳站平衡', sets: 2, reps: 30, unit: '秒／邊' }, { name: 'Side lunge 側弓步', sets: 2, reps: 8, unit: '次／邊' },
      { name: '熊爬＋螃蟹走', sets: 3, reps: 10, unit: '公尺' }]
  };

  /** 每人每天的 session 負荷（sRPE＝平均 RPE × 時長） */
  function sessionLoads(logs, durOf) {
    const by = {};
    (logs || []).forEach(r => {
      const d = normDate(r.date); if (!d || !r.player) return;
      const k = r.player + '|' + d;
      const o = by[k] = by[k] || { player: r.player, date: d, rpe: [], cats: {}, team: r.team };
      const v = parseFloat(r.rpe); if (isFinite(v)) o.rpe.push(v);
      const c = category(r.exercise || ''); o.cats[c] = (o.cats[c] || 0) + 1;
    });
    return Object.values(by).map(o => {
      const rpe = o.rpe.length ? o.rpe.reduce((a, b) => a + b, 0) / o.rpe.length : NaN;
      const dur = durOf ? durOf(o.player) : 90;
      const main = Object.keys(o.cats).filter(c => c !== '其他').sort((a, b) => o.cats[b] - o.cats[a])[0] || '其他';
      return { player: o.player, date: o.date, rpe, load: isFinite(rpe) ? Math.round(rpe * dur) : 0, main, team: o.team };
    });
  }

  function loadStatus(sessions, player, date) {
    const mine = sessions.filter(s => s.player === player && s.date < date);
    const acute = mine.filter(s => daysBetween(s.date, date) <= 7).reduce((a, s) => a + s.load, 0);
    const chronicArr = mine.filter(s => daysBetween(s.date, date) > 7 && daysBetween(s.date, date) <= 35);
    const chronic = chronicArr.reduce((a, s) => a + s.load, 0) / 4;
    const ratio = chronic > 0 && chronicArr.length >= 3 ? acute / chronic : null;
    const last = mine.sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    return { acute, chronic: Math.round(chronic), ratio, last, sessions7: mine.filter(s => daysBetween(s.date, date) <= 7).length };
  }

  /**
   * ctx = { date, slot, roster, logs, radar:{name:{date,weak,strong,total}}, monitor:{name:{sleep,sore}} }
   */
  function suggestSession(ctx, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const s = ctx.slot, date = ctx.date;
    const byName = {}; (ctx.roster || []).forEach(p => byName[p.name] = p);
    const durOf = n => ((cfg.groups[(byName[n] || {}).group] || { dur: 90 }).dur);
    const sessions = sessionLoads(ctx.logs, durOf);
    const kids = s.group === '小朋友';

    // 這組最近練了什麼
    const recent = sessions.filter(x => s.players.includes(x.player) && x.date < date && daysBetween(x.date, date) <= 14);
    const byDate = {};
    recent.forEach(x => { (byDate[x.date] = byDate[x.date] || {})[x.main] = ((byDate[x.date] || {})[x.main] || 0) + 1; });
    const recentDays = Object.keys(byDate).sort().reverse().slice(0, 3).map(d => {
      const main = Object.keys(byDate[d]).sort((a, b) => byDate[d][b] - byDate[d][a])[0];
      return { date: d, main };
    });
    const lastMain = recentDays.length ? recentDays[0].main : null;
    let type, typeWhy;
    if (kids) { type = '小朋友綜合'; typeWhy = '小朋友組以動作品質和協調為主，每堂都練一點速度、跳躍、平衡。'; }
    else if (!lastMain) { type = '速度爆發'; typeWhy = '這組最近 14 天沒有訓練紀錄，先從速度爆發開始。'; }
    else if (lastMain === '力量') { type = '速度爆發'; typeWhy = '上一堂（' + recentDays[0].date.slice(5).replace('-', '/') + '）是力量為主，今天換速度＋爆發。'; }
    else { type = '力量'; typeWhy = '上一堂（' + recentDays[0].date.slice(5).replace('-', '/') + '）是' + lastMain + '為主，今天換力量。'; }

    // 弱項統計
    const weakCount = {};
    s.players.forEach(n => { const r = (ctx.radar || {})[n]; if (r && r.weak) weakCount[r.weak] = (weakCount[r.weak] || 0) + 1; });
    const focus = Object.keys(weakCount).sort((a, b) => weakCount[b] - weakCount[a])[0] || null;
    const withData = s.players.filter(n => (ctx.radar || {})[n]).length;

    function build(level) {
      const base = TEMPLATES[type].map(x => Object.assign({}, x));
      const k = level === '重' ? 1 : level === '中' ? 0 : -1;
      let items = base.map(x => Object.assign(x, { sets: Math.max(1, x.sets + k) }));
      if (focus && WEAK_ADD[focus] && !kids) items.splice(1, 0, Object.assign({ focus: true }, WEAK_ADD[focus], { sets: Math.max(1, WEAK_ADD[focus].sets + k) }));
      if (level === '輕') { items = items.slice(0, items.length - 2).map(x => Object.assign(x, { light: true })); items.push({ name: '有氧恢復跑', sets: 1, reps: 15, unit: '分鐘' }); }
      return [{ name: '動態熱身', sets: 1, reps: 10, unit: '分鐘', warm: true }].concat(items, [{ name: '收操伸展', sets: 1, reps: 10, unit: '分鐘', warm: true }]);
    }
    const dur = (cfg.groups[s.group] || { dur: 60 }).dur;
    const options = ['重', '中', '輕'].map(lv => ({ level: lv, title: (type === '速度爆發' ? '速度＋爆發' : type) + (lv === '輕' ? '・恢復' : ''), minutes: lv === '輕' ? Math.round(dur * 0.8) : dur, items: build(lv) }));

    // 個別調整
    const people = s.players.map(n => {
      const p = byName[n] || {}, r = (ctx.radar || {})[n], m = (ctx.monitor || {})[n];
      const ls = loadStatus(sessions, n, date);
      const notes = [], flags = [];
      let suggest = null;
      if (p.growth) { flags.push(['grow', '▲生長期']); notes.push('跳躍量減半、不做最大衝刺'); }
      if (ls.ratio && ls.ratio >= cfg.spike) { flags.push(['bad', '負荷暴增']); notes.push('近 7 天負荷是平常的 ' + Math.round(ls.ratio * 100) + '% → 這堂改輕'); suggest = '輕'; }
      if (m && (+m.sore >= 4 || (+m.sleep > 0 && +m.sleep < 6))) { flags.push(['warn', +m.sore >= 4 ? '痠痛 ' + m.sore : '睡 ' + m.sleep + 'h']); notes.push('今早狀態差 → 降量'); suggest = suggest || '輕'; }
      if (s.partial && s.partial[n]) { flags.push(['warn', '只能 ' + s.partial[n] + ' 分']); notes.push('只上前 ' + s.partial[n] + ' 分鐘，跳過最後一段，先跟家長說'); }
      if (!r) { flags.push(['idle', '沒有檢測']); notes.push('還沒有檢測資料，先照團體課、觀察動作'); }
      else {
        const age = daysBetween(r.date, date);
        if (age > cfg.staleDays) { flags.push(['idle', '檢測 ' + age + ' 天前']); notes.push('檢測超過 ' + cfg.staleDays + ' 天，建議安排複測'); }
        if (r.weak && r.weak === focus && !kids) notes.push('弱項「' + r.weak + '」就是這堂重點');
        else if (r.weak && WEAK_ADD[r.weak] && !kids) notes.push('弱項「' + r.weak + '」→ 最後加 1 組 ' + WEAK_ADD[r.weak].name);
      }
      if (!notes.length) notes.push('照團體課');
      return { name: n, level: p.level || '', weak: r ? r.weak : '', testDate: r ? r.date : '', sleep: m ? m.sleep : '', sore: m ? m.sore : '',
        acute: ls.acute, chronic: ls.chronic, ratio: ls.ratio, last: ls.last, flags, notes, suggest };
    });

    const recommend = people.filter(x => x.suggest === '輕').length >= Math.ceil(s.players.length / 2) ? '輕' : '中';
    let why = typeWhy;
    if (focus && !kids) why += ' 有 ' + weakCount[focus] + ' 人的檢測弱項是「' + focus + '」，所以把它放在第二個動作。';
    if (withData < s.players.length) why += ' （' + (s.players.length - withData) + ' 人還沒有檢測資料）';
    return { type, why, focus, recentDays, options, recommend, people };
  }

  /** 回填 → 體能訓練紀錄的列（欄位跟正式表一樣） */
  function backfillRows(date, slot, option, att) {
    const rows = [];
    const label = slot.team || (slot.group + ' ' + slot.start);
    slot.players.forEach(n => {
      const a = att[n] || {};
      if (a.status && a.status !== '出席') {
        rows.push([date, '週' + weekday(date), label, n, '（' + a.status + '）', '', '', '', '', '', '', option.level + '・' + option.title, '', a.note || '', '排課台回填']);
        return;
      }
      option.items.filter(x => !x.warm).forEach(x => {
        rows.push([date, '週' + weekday(date), label, n, x.name, '—', '', String(x.sets), String(x.reps) + (x.unit && x.unit !== '次' ? x.unit : ''), '', '', option.level + '・' + option.title,
          String(a.rpe || ''), [a.done && a.done !== '全部完成' ? a.done : '', a.note || ''].filter(Boolean).join('；'), '排課台回填']);
      });
    });
    return rows;
  }

  const API = { CFG, availability, fmt, toMin, weekday, addDays, daysBetween, normDate, nameIndex, parseTennisText, schedule, recheck, toChatText,
    category, sessionLoads, loadStatus, suggestSession, backfillRows, WEAK_ADD };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TrainEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
