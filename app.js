(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var store = {
    get: function (key, def) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? def : JSON.parse(raw);
      } catch (e) { return def; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
  };

  var DATA = window.CHANTS_DATA || { chants: [] };
  var PARTITIONS = window.CV_PARTITIONS || {};
  var CHANTS = (DATA.chants || []).slice().sort(function (a, b) {
    return a.base - b.base || String(a.suffixe).localeCompare(String(b.suffixe));
  });
  var BY_ID = {};
  CHANTS.forEach(function (c) { BY_ID[c.id] = c; });

  var S = {
    view: "home",
    previousView: "home",
    sort: "num",
    favOnly: false,
    range: null,
    query: "",
    currentId: null,
    lastId: store.get("cv_last", null),
    favorites: {},
    font: store.get("cv_font", 19),
    lineAeree: store.get("cv_line", false),
    keepScreenOn: store.get("cv_screen", true),
    theme: store.get("cv_theme", "auto"),
    projection: false,
    listScroll: 0
  };

  (store.get("cv_fav", []) || []).forEach(function (id) {
    if (BY_ID[id]) S.favorites[id] = true;
  });

  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’'`´]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function favCount() { return Object.keys(S.favorites).length; }
  function isFav(id) { return !!S.favorites[id]; }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2300);
  }

  /* ---------- Android ---------- */
  function setScreenOn(on) {
    if (window.Android && typeof window.Android.setKeepScreenOn === "function") {
      try { window.Android.setKeepScreenOn(!!on); } catch (e) {}
    }
  }
  function setFullscreen(on) {
    if (window.Android && typeof window.Android.setFullscreen === "function") {
      try { window.Android.setFullscreen(!!on); } catch (e) {}
    }
  }

  /* ---------- Thème / affichage ---------- */
  function applyTheme() {
    var dark = S.theme === "dark";
    if (S.theme === "auto" && window.matchMedia) {
      try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    }
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#120E0F" : "#54162A");
    $$("#themeSeg button").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme") === S.theme);
    });
  }

  function setFont(px) {
    var value = Math.max(15, Math.min(30, Number(px) || 19));
    S.font = value;
    document.documentElement.style.setProperty("--lyrics-size", value + "px");
    store.set("cv_font", value);
    $("#fontValue").textContent = value;
    $("#sheetFontValue").textContent = value;
  }

  function setLine(on, silent) {
    S.lineAeree = !!on;
    document.body.classList.toggle("line-aeree", S.lineAeree);
    store.set("cv_line", S.lineAeree);
    setSwitch("#switchLine", S.lineAeree);
    setSwitch("#sheetLine", S.lineAeree);
  }

  function setSwitch(sel, on) {
    var el = $(sel);
    if (el) el.setAttribute("aria-checked", on ? "true" : "false");
  }

  function setKeepScreen(on) {
    S.keepScreenOn = !!on;
    store.set("cv_screen", S.keepScreenOn);
    setSwitch("#switchScreen", S.keepScreenOn);
    if (S.view === "song" || S.projection) setScreenOn(S.keepScreenOn || S.projection);
  }

  function syncSettings() {
    applyTheme();
    $("#fontValue").textContent = S.font;
    $("#sheetFontValue").textContent = S.font;
    setSwitch("#switchLine", S.lineAeree);
    setSwitch("#sheetLine", S.lineAeree);
    setSwitch("#switchScreen", S.keepScreenOn);
  }

  /* ---------- Navigation ---------- */
  function showView(name, keepScroll) {
    S.view = name;
    document.body.setAttribute("data-view", name);
    $$(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.getAttribute("data-view") === name);
    });
    updateTabs();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  function updateTabs() {
    var tab = S.view;
    if (S.view === "song") tab = "list";
    if (S.view === "list" && S.favOnly) tab = "fav";
    $$("#tabbar button").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tab") === tab);
    });
  }

  function goHome() {
    if (S.projection) exitProjection();
    showView("home");
    renderHome();
    setScreenOn(false);
  }

  function openSettings() {
    if (S.projection) exitProjection();
    showView("settings");
    syncSettings();
    setScreenOn(false);
  }

  function parseRange(value) {
    if (!value || value === "all") return null;
    var m = String(value).match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
  }

  function openList(opts) {
    opts = opts || {};
    if (S.projection) exitProjection();
    if (opts.reset) {
      S.query = "";
      S.favOnly = false;
      S.range = null;
      S.sort = "num";
      $("#search").value = "";
    }
    if (opts.fav !== undefined) S.favOnly = !!opts.fav;
    if (opts.range !== undefined) S.range = opts.range;
    if (opts.sort) S.sort = opts.sort;
    if (opts.query !== undefined) {
      S.query = opts.query;
      $("#search").value = opts.query;
    }
    $("#clearSearch").classList.toggle("is-hidden", !S.query);
    updateChips();
    showView("list");
    renderList();
    setScreenOn(false);
    if (opts.focusSearch) {
      setTimeout(function () { $("#search").focus(); }, 280);
    }
  }

  function openSong(id) {
    var c = BY_ID[id];
    if (!c) return;
    if (S.view === "list") S.listScroll = window.scrollY || 0;
    if (S.view !== "song") S.previousView = S.view;
    S.currentId = id;
    S.lastId = id;
    store.set("cv_last", id);
    renderSong();
    showView("song");
    window.scrollTo(0, 0);
    setScreenOn(S.keepScreenOn);
  }

  function returnFromSong() {
    var target = S.previousView || "list";
    setScreenOn(false);
    if (target === "home") {
      goHome();
      return;
    }
    showView("list", true);
    renderList();
    updateChips();
    setTimeout(function () { window.scrollTo(0, S.listScroll || 0); }, 40);
  }

  window.appBack = function () {
    if (part.open) { closePartition(); return true; }
    if (S.projection) { exitProjection(); return true; }
    if (!$("#fontSheet").classList.contains("is-hidden")) { closeFontSheet(); return true; }
    if (S.view === "song") { returnFromSong(); return true; }
    if (S.view === "settings") { goHome(); return true; }
    if (S.view === "list") {
      if (S.query || S.favOnly || S.range) {
        S.query = "";
        S.favOnly = false;
        S.range = null;
        $("#search").value = "";
        $("#clearSearch").classList.add("is-hidden");
        updateChips();
        renderList();
        window.scrollTo(0, 0);
        return true;
      }
      goHome();
      return true;
    }
    return false;
  };

  /* ---------- Accueil ---------- */
  function renderHome() {
    $("#heroCount").textContent = CHANTS.length;

    var card = $("#continueCard");
    var last = S.lastId && BY_ID[S.lastId];
    if (last) {
      card.classList.remove("is-hidden");
      card.setAttribute("data-open", last.id);
      card.innerHTML =
        '<span class="continue-art">' + esc(last.numero) + "</span>" +
        '<span class="continue-txt"><small>Reprendre la lecture</small><b>' + esc(last.titre) + "</b></span>" +
        '<svg><use href="#i-chevron-right"/></svg>';
    } else {
      card.classList.add("is-hidden");
      card.removeAttribute("data-open");
    }

    var n = favCount();
    $("#favCount").textContent = n === 0 ? "Aucun favori" : n + " cantique" + (n > 1 ? "s" : "");

    var ranges = "";
    for (var start = 1; start <= 394; start += 50) {
      var end = Math.min(start + 49, 394);
      ranges += '<button class="range-chip" data-range="' + start + "-" + end + '">' + start + " – " + end + "</button>";
    }
    $("#rangeGrid").innerHTML = ranges;

    var favs = CHANTS.filter(function (c) { return isFav(c.id); }).slice(0, 4);
    var preview = $("#favPreview");
    if (favs.length) {
      preview.innerHTML = favs.map(songRowHTML).join("");
    } else {
      preview.innerHTML = '<p class="empty">Touchez le cœur d\'un cantique pour le retrouver ici.</p>';
    }
  }

  /* ---------- Liste ---------- */
  function firstLine(c) {
    var lines = String(c.paroles || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var line = lines.find(function (l) {
      return !/^(\d{1,2}\s*[.)]|chœur|choeur|refrain|solo)\s*[:\-–]?\s*$/i.test(l);
    }) || lines[0] || "";
    return line.replace(/^\s*\d{1,2}\s*[.)]\s*/, "").slice(0, 120);
  }

  function songRowHTML(c) {
    var fav = isFav(c.id);
    var badge = c.suffixe ? "num-badge small" : "num-badge";
    var part = partitionOf(c.id)
      ? '<span class="row-part" aria-label="Partition disponible" title="Partition disponible">' +
        '<svg><use href="#i-music"/></svg></span>'
      : "";
    return (
      '<div class="song-row" data-open="' + esc(c.id) + '" role="button" tabindex="0">' +
        '<span class="' + badge + '">' + esc(c.numero) + "</span>" +
        '<span class="row-txt"><span class="row-title">' + esc(c.titre) + "</span>" +
        '<span class="row-sub">' + esc(firstLine(c)) + "</span></span>" +
        part +
        '<button class="row-fav' + (fav ? " is-on" : "") + '" data-fav-id="' + esc(c.id) + '" aria-label="' +
          (fav ? "Retirer des favoris" : "Ajouter aux favoris") + '">' +
          '<svg><use href="#i-heart"/></svg></button>' +
      "</div>"
    );
  }

  function score(c, q) {
    var num = normalize(c.numero);
    if (num === q) return 120;
    if (num.indexOf(q) === 0) return 70;
    var title = normalize(c.titre);
    if (title === q) return 90;
    if (title.indexOf(q) === 0) return 60;
    if (title.indexOf(q) !== -1) return 40;
    if (normalize(c.paroles).indexOf(q) !== -1) return 15;
    return 0;
  }

  function getFiltered() {
    var list = CHANTS;
    if (S.favOnly) list = list.filter(function (c) { return isFav(c.id); });
    if (S.range) {
      list = list.filter(function (c) { return c.base >= S.range[0] && c.base <= S.range[1]; });
    }
    var q = normalize(S.query);
    if (q) {
      var tokens = q.split(" ").filter(Boolean);
      list = list.filter(function (c) {
        for (var i = 0; i < tokens.length; i++) {
          if (c.recherche.indexOf(tokens[i]) === -1) return false;
        }
        return true;
      });
      list = list.slice().sort(function (a, b) { return score(b, q) - score(a, q) || a.base - b.base; });
    } else if (S.sort === "az") {
      list = list.slice().sort(function (a, b) {
        return a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" });
      });
    } else {
      list = list.slice().sort(function (a, b) {
        return a.base - b.base || String(a.suffixe).localeCompare(String(b.suffixe));
      });
    }
    return list;
  }

  function renderList() {
    var list = getFiltered();
    var title = "Cantiques";
    if (S.favOnly) title = "Mes favoris";
    else if (S.range) title = "Cantiques " + S.range[0] + " – " + S.range[1];
    $("#listTitle").textContent = title;
    $("#listCount").textContent = list.length + " cantique" + (list.length > 1 ? "s" : "");
    $("#list").innerHTML = list.map(songRowHTML).join("");
    $("#listEmpty").classList.toggle("is-hidden", list.length > 0);
  }

  function updateChips() {
    $$(".chip[data-sort]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-sort") === S.sort);
    });
    $("#chipFav").classList.toggle("is-active", S.favOnly);
  }

  /* ---------- Fiche chant ---------- */
  function parseLyrics(text) {
    var lines = String(text || "").split("\n");
    var blocks = [];
    var current = null;
    var verseRe = /^\s*\d{1,2}\s*[.)]\s*/;
    var chorusRe = /^\s*(chœur|choeur|refrain|solo)\s*[:\-–]?\s*(.*)$/i;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, "");
      if (!line.trim()) { current = null; continue; }
      if (verseRe.test(line)) {
        blocks.push({ type: "verse", lines: [line] });
        current = blocks[blocks.length - 1];
        continue;
      }
      var cm = line.match(chorusRe);
      if (cm) {
        var rawLabel = cm[1].toLowerCase();
        var label = rawLabel === "choeur" ? "Chœur" : rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        blocks.push({ type: "chorus", label: label, lines: cm[2] ? [cm[2]] : [] });
        current = blocks[blocks.length - 1];
        continue;
      }
      if (!current) {
        blocks.push({ type: "verse", lines: [line] });
        current = blocks[blocks.length - 1];
      } else {
        current.lines.push(line);
      }
    }
    return blocks;
  }

  function countVerses(text) {
    return parseLyrics(text).filter(function (b) { return b.type === "verse"; }).length;
  }

  function isRefrainBlock(b) {
    return b.type === "chorus" && /^(refrain|chœur|choeur)$/i.test(b.label);
  }

  function verseBody(b) {
    var lines = b.lines.slice();
    if (lines.length) lines[0] = lines[0].replace(/^\s*\d{1,2}\s*[.)]\s*/, "");
    return lines;
  }

  // Refrain sans étiquette : on repère les derniers vers identiques présents
  // dans au moins deux couplets (ex. « Loué soit ton amour… » au n° 18).
  function commonSuffixLength(blocks) {
    var groups = blocks
      .filter(function (b) { return b.type === "verse"; })
      .map(function (b) {
        return verseBody(b).map(normalize).filter(Boolean);
      })
      .filter(function (g) { return g.length; });
    if (groups.length < 2) return 0;
    var max = 8;
    groups.forEach(function (g) { max = Math.min(max, g.length); });
    for (var len = max; len >= 2; len--) {
      var counts = {};
      for (var i = 0; i < groups.length; i++) {
        var key = groups[i].slice(-len).join("\u0001");
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] >= 2 && key.replace(/\u0001/g, " ").replace(/\s+/g, "").length > 8) {
          return len;
        }
      }
    }
    return 0;
  }

  function verseEndsWithRefrain(b, refrain) {
    var ref = refrain.lines.map(normalize).filter(Boolean);
    if (!ref.length) return false;
    var body = verseBody(b).map(normalize).filter(Boolean);
    if (body.length < ref.length) return false;
    return body.slice(-ref.length).join("\u0001") === ref.join("\u0001");
  }

  function chorusHTML(b, extra) {
    var body = b.lines.length ? '<p class="lines">' + esc(b.lines.join("\n")) + "</p>" : "";
    var cls = "chorus" + (isRefrainBlock(b) ? " is-refrain" : "") + (extra ? " " + extra : "");
    return '<div class="' + cls + '"><span class="chorus-label">' + esc(b.label) + "</span>" + body + "</div>";
  }

  function verseHTML(b, suffixLen, trimIncipit) {
    var first = b.lines[0] || "";
    var m = first.match(/^\s*(\d{1,2}\s*[.)])\s*(.*)$/);
    var vnum = m ? '<span class="vnum">' + esc(m[1]) + "</span>" : "";
    var body = m ? [m[2]].concat(b.lines.slice(1)) : b.lines.slice();
    if (trimIncipit) {
      while (body.length > 1 && /(?:…|\.\.\.)\s*(?:etc\.?)?$|etc\.?$/i.test(body[body.length - 1].trim())) {
        body.pop();
      }
    }

    var start = body.length;
    if (suffixLen >= 2) {
      var seen = 0;
      for (var i = body.length - 1; i >= 0; i--) {
        if (body[i].trim()) {
          seen++;
          if (seen === suffixLen) { start = i; break; }
        }
      }
      if (seen < suffixLen) start = body.length;
    }

    var pre = body.slice(0, start);
    var ref = body.slice(start);
    var html = "";
    if (pre.length) {
      html = vnum + esc(pre[0]);
      if (pre.length > 1) html += "\n" + pre.slice(1).map(esc).join("\n");
    } else if (vnum) {
      html = vnum;
    }
    if (ref.length) {
      html += (html ? "\n" : "") + '<em class="refrain-inline">' + ref.map(esc).join("\n") + "</em>";
    }
    return '<div class="verse-block"><p>' + html + "</p></div>";
  }

  function lyricsHTML(text) {
    var blocks = parseLyrics(text);
    if (!blocks.length) return '<div class="verse-block"><p>' + esc(text) + "</p></div>";
    var labeled = blocks.filter(isRefrainBlock);
    var refrain = labeled.length === 1 ? labeled[0] : null;
    var suffixLen = labeled.length ? 0 : commonSuffixLength(blocks);
    var html = "";

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === "chorus") {
        html += chorusHTML(b);
        continue;
      }
      var next = blocks[i + 1];
      var nextIsChorus = next && next.type === "chorus";
      var willRepeat = !!(refrain && !nextIsChorus && !verseEndsWithRefrain(b, refrain));
      html += verseHTML(b, suffixLen, willRepeat);
      if (willRepeat) html += chorusHTML(refrain, "is-repeat");
    }
    return html;
  }

  /* ---------- Partition ---------- */
  var part = {
    open: false,
    scale: 1,
    tx: 0,
    ty: 0,
    pointers: {},
    lastDist: 0,
    lastMid: null,
    lastTap: 0,
    tapTime: 0,
    moved: false
  };

  function partitionOf(id) {
    var p = PARTITIONS[id];
    return p && p.pages && p.pages.length ? p : null;
  }

  function partViewport() {
    var v = $("#partViewport");
    return { w: v.clientWidth, h: v.clientHeight };
  }

  function partClamp() {
    var v = partViewport();
    var track = $("#partTrack");
    var sw = track.offsetWidth * part.scale;
    var sh = track.offsetHeight * part.scale;
    part.tx = sw <= v.w ? (v.w - sw) / 2 : Math.min(0, Math.max(v.w - sw, part.tx));
    part.ty = sh <= v.h ? (v.h - sh) / 2 : Math.min(0, Math.max(v.h - sh, part.ty));
  }

  function partApply() {
    partClamp();
    $("#partTrack").style.transform =
      "translate(" + part.tx + "px," + part.ty + "px) scale(" + part.scale + ")";
    $("#partReset").textContent = Math.round(part.scale * 100) + "%";
  }

  function partZoom(next, cx, cy) {
    next = Math.max(1, Math.min(5, next));
    if (Math.abs(next - part.scale) < 0.001) return;
    if (cx == null) {
      var v = partViewport();
      cx = v.w / 2;
      cy = v.h / 2;
    }
    var k = next / part.scale;
    part.tx = cx - (cx - part.tx) * k;
    part.ty = cy - (cy - part.ty) * k;
    part.scale = next;
    partApply();
  }

  function partReset() {
    part.scale = 1;
    part.tx = 0;
    part.ty = 0;
    partApply();
  }

  function partPointerList() {
    return Object.keys(part.pointers).map(function (k) { return part.pointers[k]; });
  }

  function partDistance(pts) {
    var dx = pts[0].x - pts[1].x;
    var dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function partMid(pts) {
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  function openPartition(id) {
    var c = BY_ID[id];
    var p = partitionOf(id);
    if (!c || !p) return;
    $("#partTitle").textContent = "Cantique " + c.numero;
    $("#partSub").textContent = c.titre;
    $("#partTrack").innerHTML = p.pages.map(function (pg) {
      return '<img src="assets/partitions/' + pg.f + '" width="' + pg.w + '" height="' + pg.h +
        '" alt="Partition du cantique ' + esc(c.numero) + '" draggable="false">';
    }).join("");
    $("#partFoot").textContent = "Partitions : " +
      (/1926/.test(p.source || "") ? "recueil de 1926" : "Cantiquest") + " · " +
      p.pages.length + " page" + (p.pages.length > 1 ? "s" : "");
    part.open = true;
    part.pointers = {};
    part.lastDist = 0;
    part.lastMid = null;
    part.scale = 1;
    part.tx = 0;
    part.ty = 0;
    $("#partitionView").classList.remove("is-hidden");
    document.body.classList.add("part-open");
    partApply();
  }

  function closePartition() {
    if (!part.open) return;
    part.open = false;
    $("#partitionView").classList.add("is-hidden");
    document.body.classList.remove("part-open");
    $("#partTrack").innerHTML = "";
  }

  function renderSong() {
    var c = BY_ID[S.currentId];
    if (!c) return;
    $("#songNum").textContent = c.numero;
    $("#songTitle").textContent = c.titre;
    var nb = c.couplets || countVerses(c.paroles) || 0;
    var p = partitionOf(c.id);
    $("#songMeta").innerHTML =
      "<span>" + nb + " couplet" + (nb > 1 ? "s" : "") + "</span>" +
      "<span>Réf. " + esc(c.ref) + "</span>" +
      (p
        ? '<button type="button" class="meta-chip" id="btnPartition"><svg><use href="#i-music"/></svg>Partition</button>'
        : "");
    $("#lyrics").innerHTML = lyricsHTML(c.paroles);
    $("#btnFav").classList.toggle("is-on", isFav(c.id));
    $("#btnFav").setAttribute("aria-label", isFav(c.id) ? "Retirer des favoris" : "Ajouter aux favoris");

    var idx = CHANTS.findIndex(function (x) { return x.id === c.id; });
    $("#btnPrev").disabled = idx <= 0;
    $("#btnNext").disabled = idx < 0 || idx >= CHANTS.length - 1;
  }

  function toggleFav(id) {
    if (!BY_ID[id]) return;
    if (S.favorites[id]) delete S.favorites[id];
    else S.favorites[id] = true;
    store.set("cv_fav", Object.keys(S.favorites));
    if (S.view === "song") {
      renderSong();
    }
    if (S.view === "list") renderList();
    renderHome();
    toast(S.favorites[id] ? "Ajouté aux favoris" : "Retiré des favoris");
  }

  function shareSong() {
    var c = BY_ID[S.currentId];
    if (!c) return;
    var text = "Cantique " + c.numero + " — " + c.titre + "\n\n" + c.paroles +
      "\n\n— Chant de Victoire · Église Évangélique du Gabon – Région Synodale Ogooué-Estuaire – Paroisse Protestante de Jéricho";
    if (window.Android && typeof window.Android.share === "function") {
      try { window.Android.share(text); return; } catch (e) {}
    }
    if (navigator.share) {
      navigator.share({ title: c.titre, text: text }).catch(function () {});
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Paroles copiées");
    } catch (e) {
      toast("Partage indisponible");
    }
    ta.remove();
  }

  /* ---------- Mode culte ---------- */
  function enterProjection() {
    S.projection = true;
    document.body.classList.add("projection");
    setScreenOn(true);
    setFullscreen(true);
    window.scrollTo(0, 0);
    toast("Mode culte — touchez l'écran pour quitter");
  }

  function exitProjection() {
    S.projection = false;
    document.body.classList.remove("projection");
    setFullscreen(false);
    setScreenOn(S.keepScreenOn && S.view === "song");
  }

  /* ---------- Feuille de texte ---------- */
  function openFontSheet() {
    syncSettings();
    $("#fontSheet").classList.remove("is-hidden");
  }
  function closeFontSheet() {
    $("#fontSheet").classList.add("is-hidden");
  }

  /* ---------- Événements ---------- */
  function bind() {
    // Recherche
    var searchTimer = null;
    $("#search").addEventListener("input", function (e) {
      var value = e.target.value;
      $("#clearSearch").classList.toggle("is-hidden", !value);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        S.query = value;
        if (value) S.range = null;
        renderList();
      }, 70);
    });

    $("#clearSearch").addEventListener("click", function () {
      $("#search").value = "";
      S.query = "";
      $("#clearSearch").classList.add("is-hidden");
      renderList();
      $("#search").focus();
    });

    $("#homeSearch").addEventListener("click", function () {
      openList({ reset: true, focusSearch: true });
    });

    // Clics délégués
    document.addEventListener("click", function (e) {
      var target = e.target;

      var go = target.closest("[data-go]");
      if (go) {
        var dest = go.getAttribute("data-go");
        if (dest === "home") goHome();
        else if (dest === "settings") openSettings();
        else if (dest === "list") {
          openList({
            reset: true,
            fav: go.getAttribute("data-fav") === "1",
            range: parseRange(go.getAttribute("data-range"))
          });
        }
        return;
      }

      var back = target.closest("[data-back]");
      if (back) { appBack(); return; }

      var fav = target.closest("[data-fav-id]");
      if (fav) {
        e.preventDefault();
        e.stopPropagation();
        toggleFav(fav.getAttribute("data-fav-id"));
        return;
      }

      var open = target.closest("[data-open]");
      if (open) { openSong(open.getAttribute("data-open")); return; }

      var range = target.closest("[data-range]");
      if (range) {
        openList({ reset: true, range: parseRange(range.getAttribute("data-range")) });
        return;
      }

      var sort = target.closest("[data-sort]");
      if (sort) {
        S.sort = sort.getAttribute("data-sort");
        updateChips();
        renderList();
        window.scrollTo(0, 0);
        return;
      }

      var theme = target.closest("#themeSeg [data-theme]");
      if (theme) {
        S.theme = theme.getAttribute("data-theme");
        store.set("cv_theme", S.theme);
        applyTheme();
        return;
      }

      if (target.closest("[data-close-sheet]")) { closeFontSheet(); return; }
    });

    // Chips favoris
    $("#chipFav").addEventListener("click", function () {
      S.favOnly = !S.favOnly;
      updateChips();
      renderList();
      window.scrollTo(0, 0);
    });

    // Fiche chant
    $("#btnFav").addEventListener("click", function () { toggleFav(S.currentId); });
    $("#btnShare").addEventListener("click", shareSong);
    $("#btnFont").addEventListener("click", openFontSheet);

    // Partition
    $("#partClose").addEventListener("click", closePartition);
    $("#partPlus").addEventListener("click", function () { partZoom(part.scale * 1.25); });
    $("#partMinus").addEventListener("click", function () { partZoom(part.scale / 1.25); });
    $("#partReset").addEventListener("click", partReset);
    $("#songMeta").addEventListener("click", function (e) {
      if (e.target.closest("#btnPartition")) openPartition(S.currentId);
    });

    var pv = $("#partViewport");
    pv.addEventListener("pointerdown", function (e) {
      pv.setPointerCapture(e.pointerId);
      var r = pv.getBoundingClientRect();
      part.pointers[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
      var ids = Object.keys(part.pointers);
      if (ids.length === 1) {
        part.moved = false;
        part.tapTime = Date.now();
      }
      if (ids.length === 2) {
        var pts = partPointerList();
        part.lastDist = partDistance(pts);
        part.lastMid = partMid(pts);
      }
    });
    pv.addEventListener("pointermove", function (e) {
      var rec = part.pointers[e.pointerId];
      if (!rec) return;
      var r = pv.getBoundingClientRect();
      var dx = e.clientX - r.left - rec.x;
      var dy = e.clientY - r.top - rec.y;
      rec.x += dx;
      rec.y += dy;
      if (Math.abs(dx) + Math.abs(dy) > 2) part.moved = true;
      var ids = Object.keys(part.pointers);
      if (ids.length >= 2) {
        var pts = partPointerList();
        var dist = partDistance(pts);
        var mid = partMid(pts);
        if (part.lastDist > 0) {
          part.tx += mid.x - part.lastMid.x;
          part.ty += mid.y - part.lastMid.y;
          partZoom(part.scale * (dist / part.lastDist), mid.x, mid.y);
        }
        part.lastDist = dist;
        part.lastMid = mid;
      } else {
        part.tx += dx;
        part.ty += dy;
        partApply();
      }
    });
    var partEnd = function (e) {
      if (!part.pointers[e.pointerId]) return;
      delete part.pointers[e.pointerId];
      if (Object.keys(part.pointers).length < 2) {
        part.lastDist = 0;
        part.lastMid = null;
      }
      if (!Object.keys(part.pointers).length && !part.moved) {
        var now = Date.now();
        if (now - part.tapTime < 320) {
          if (now - part.lastTap < 350) {
            var r = pv.getBoundingClientRect();
            partZoom(part.scale > 1.05 ? 1 : 2.2, e.clientX - r.left, e.clientY - r.top);
            part.lastTap = 0;
          } else {
            part.lastTap = now;
          }
        }
      }
    };
    pv.addEventListener("pointerup", partEnd);
    pv.addEventListener("pointercancel", partEnd);
    pv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = pv.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        partZoom(part.scale * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top);
      } else {
        part.tx -= e.deltaX;
        part.ty -= e.deltaY;
        partApply();
      }
    }, { passive: false });
    window.addEventListener("resize", function () {
      if (part.open) partReset();
    });
    $("#btnProjection").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      enterProjection();
    });
    $("#view-song").addEventListener("click", function () {
      if (S.projection) exitProjection();
    });

    $("#btnPrev").addEventListener("click", function () {
      var idx = CHANTS.findIndex(function (x) { return x.id === S.currentId; });
      if (idx > 0) openSong(CHANTS[idx - 1].id);
    });
    $("#btnNext").addEventListener("click", function () {
      var idx = CHANTS.findIndex(function (x) { return x.id === S.currentId; });
      if (idx >= 0 && idx < CHANTS.length - 1) openSong(CHANTS[idx + 1].id);
    });

    // Réglages
    $("#fontMinus").addEventListener("click", function () { setFont(S.font - 1); });
    $("#fontPlus").addEventListener("click", function () { setFont(S.font + 1); });
    $("#switchLine").addEventListener("click", function () { setLine(!S.lineAeree); });
    $("#switchScreen").addEventListener("click", function () { setKeepScreen(!S.keepScreenOn); });
    $("#resetApp").addEventListener("click", function () {
      if (!window.confirm("Effacer les favoris et l'historique de lecture ?")) return;
      S.favorites = {};
      S.lastId = null;
      store.set("cv_fav", []);
      store.set("cv_last", null);
      renderHome();
      toast("Favoris et historique effacés");
    });

    // Feuille de texte
    $("#sheetMinus").addEventListener("click", function () { setFont(S.font - 1); });
    $("#sheetPlus").addEventListener("click", function () { setFont(S.font + 1); });
    $("#sheetLine").addEventListener("click", function () { setLine(!S.lineAeree); });

    // Clavier (test sur ordinateur)
    document.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.getAttribute && e.target.getAttribute("data-open")) {
        openSong(e.target.getAttribute("data-open"));
      }
      if (e.key === "Escape") appBack();
    });

    // Thème automatique
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        var onChange = function () { if (S.theme === "auto") applyTheme(); };
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch (e) {}
    }
  }

  /* ---------- Démarrage ---------- */
  function init() {
    applyTheme();
    setFont(S.font);
    setLine(S.lineAeree, true);
    syncSettings();
    renderHome();
    updateChips();
    bind();
    showView("home");

    setTimeout(function () {
      var splash = $("#splash");
      if (splash) {
        splash.classList.add("is-out");
        setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 600);
      }
    }, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
