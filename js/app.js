/* Грозный: как строился город. Интерактивная карта для музея ЧГУ им. А. А. Кадырова.
   Всё работает локально: данные лежат в app/data/*.js, отрисовка — deck.gl (app/lib). */
(function () {
  'use strict';

  var D = window.deck;
  var META = window.GZ_META, B = window.GZ_BUILDINGS, R = window.GZ_ROADS, A = window.GZ_AREAS, BD = window.GZ_BOUNDARY;
  var Y0 = META.y0, Y1 = META.y1;          // 2000..2026
  var T0 = Y0 - 1, T1 = Y1;                // шкала: в точке Y строительство года Y завершено
  var NYEARS = Y1 - Y0 + 1;
  var SEC_PER_YEAR = 1.5;                  // скорость проигрывания
  var IDLE_MS = 180000;                    // через 3 минуты без касаний — демонстрационный режим
  var FONT = '"Segoe UI", Roboto, Arial, sans-serif';

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return n.toLocaleString('ru-RU'); };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  // ---------- цвета ----------
  // Вся новая застройка — в одной сдержанной гамме светлого камня (чуть холоднее у ранних лет, теплее у новых),
  // а дома текущего года вспыхивают золотом и «остывают» до общего цвета.
  var STOPS = [[2000, [168, 180, 198]], [2013, [214, 206, 188]], [2026, [242, 208, 156]]];
  var HOT = [255, 190, 90];
  var CHGU = [125, 211, 252];
  function mix(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function yearColor(y) {
    for (var i = 1; i < STOPS.length; i++) {
      if (y <= STOPS[i][0]) return mix(STOPS[i - 1][1], STOPS[i][1], clamp((y - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]), 0, 1));
    }
    return STOPS[STOPS.length - 1][1];
  }
  var css = function (c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; };

  var CATS = {
    religion: ['Религия', [196, 181, 253]], highrise: ['Высотные здания', [246, 196, 83]], government: ['Власть', [252, 165, 165]],
    culture: ['Культура', [249, 168, 212]], sport: ['Спорт', [134, 239, 172]], commerce: ['Торговля', [253, 186, 116]],
    park: ['Парки и скверы', [110, 231, 183]], monument: ['Памятники', [226, 232, 240]], transport: ['Транспорт', [147, 197, 253]],
    other: ['Город', [203, 213, 225]], chgu: ['ЧГУ', CHGU], university: ['Образование', [103, 232, 249]],
    school: ['Школы', [165, 243, 252]], kindergarten: ['Детские сады', [254, 240, 138]], health: ['Здравоохранение', [253, 164, 175]],
    housing: ['Жильё', [253, 230, 138]]
  };
  var MAJOR = { 'Сердце Чечни': 1, 'Грозный-Сити': 1, 'Ахмат Арена': 1, 'Аэропорт Грозный': 1, 'ЧГУ, главный корпус': 1,
    'Ж/д вокзал': 1, 'Грозный Молл': 1, 'Колизей': 1, 'Мемориал Славы': 1, 'Национальная библиотека': 1, 'ЧГУ, новый корпус': 1,
    'Ахмат Тауэр': 1 };

  // ---------- распаковка данных ----------
  function dec(arr, scale, origin) {
    var out = new Array(arr.length / 2), x = 0, y = 0;
    for (var i = 0, k = 0; i < arr.length; i += 2, k++) {
      x += arr[i]; y += arr[i + 1];
      out[k] = [origin[0] + x / scale, origin[1] + y / scale];
    }
    return out;
  }
  var decPoly = function (rings, src) { return rings.map(function (r) { return dec(r, src.scale, src.origin); }); };

  // Правки сотрудников музея: файл data/corrections.js плюс правки, сделанные в этом браузере и ещё не сохранённые в файл.
  // Режим правки включается адресом index.html?edit (Правка.bat) или сочетанием Ctrl+Shift+E.
  var EDIT = /[?&]edit\b/.test(location.search);
  var LS_KEY = 'gz-corrections';
  var fileCorr = window.GZ_CORRECTIONS || {};
  var localCorr = {};
  try { localCorr = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (err) { localCorr = {}; }
  var has = function (obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); };
  var corrOf = function (id) { return has(localCorr, id) ? localCorr[id] : fileCorr[id]; };

  var ALL = [], byId = {};
  B.items.forEach(function (it) {
    var rings = [];
    for (var k = 9; k < it.length; k++) rings.push(dec(it[k], B.scale, B.origin));
    var p0 = rings[0][0];
    var j = (((p0[0] * 1e5 * 73856093) ^ (p0[1] * 1e5 * 19349663)) >>> 0) % 1000 / 1000;
    var o = { p: rings, h: it[1], y: it[0], s: it[2], n: it[3] >= 0 ? B.names[it[3]] : '', t: it[4] >= 0 ? B.types[it[4]] : '',
      lv: it[5], u: it[6], id: it[7], g: it[8], j: j, e: 0, sel: 0 };
    o.y0 = o.y; o.s0 = o.s; o.n0 = o.n;
    var sx = 0, sy = 0, r0 = rings[0];
    for (var q = 0; q < r0.length; q++) { sx += r0[q][0]; sy += r0[q][1]; }
    o.c = [sx / r0.length, sy / r0.length];
    ALL.push(o);
    (byId[o.id] = byId[o.id] || []).push(o);
  });
  var keyOf = function (o) { return o.y < Y0 ? 'base' : String(o.y); };
  // применяет правку к зданию (или возвращает исходные данные); возвращает затронутые группы
  function applyCorr(id) {
    var c = corrOf(id), keys = {};
    (byId[id] || []).forEach(function (o) {
      keys[keyOf(o)] = 1;
      if (c && c.k) { o.y = Y1; o.s = 'k'; o.e = 1; }
      else if (c && c.y != null) { o.y = c.y; o.s = 'e'; o.e = 1; }
      else { o.y = o.y0; o.s = o.s0; o.e = 0; }
      o.n = c && c.n != null ? c.n : o.n0;
      keys[keyOf(o)] = 1;
    });
    return keys;
  }
  Object.keys(fileCorr).concat(Object.keys(localCorr)).forEach(applyCorr);

  var base = [], byYear = {}, groupVer = 0;
  function regroup(keys) {
    groupVer++;
    if (!keys) {
      base = []; byYear = {};
      ALL.forEach(function (o) { if (o.y < Y0) base.push(o); else (byYear[o.y] = byYear[o.y] || []).push(o); });
      return;
    }
    Object.keys(keys).forEach(function (k) {
      var arr = ALL.filter(function (o) { return keyOf(o) === k; });
      if (k === 'base') base = arr; else if (arr.length) byYear[k] = arr; else delete byYear[k];
    });
  }
  regroup(null);

  var roadsByClass = [[], [], [], [], [], []];
  R.items.forEach(function (it) { roadsByClass[it[0]].push(dec(it[1], R.scale, R.origin)); });
  var areas = {};
  Object.keys(A.groups).forEach(function (g) { areas[g] = A.groups[g].map(function (p) { return decPoly(p, A); }); });
  var rivers = A.rivers.map(function (r) { return { t: r[0], p: dec(r[1], A.scale, A.origin) }; });
  var cityPolys = BD.city.map(function (p) { return decPoly(p, BD); });
  var districts = BD.districts.map(function (d) {
    return { name: d.name.replace(' район', ''), c: d.c, polys: d.polys.map(function (p) { return decPoly(p, BD); }) };
  });
  var districtLines = [];
  districts.forEach(function (d) { d.polys.forEach(function (p) { districtLines.push(p[0]); }); });
  var cityLines = cityPolys.map(function (p) { return p[0]; });

  var LM = META.landmarks.map(function (l, i) { l.i = i; return l; });
  // статистика считается по зданиям в браузере, чтобы учитывать правки
  var cum = [], maxPerYear = 1;
  function recomputeStats() {
    var per = [], baseN = 0, seen = {}, acc = 0, i;
    for (i = 0; i < NYEARS; i++) per.push(0);
    ALL.forEach(function (o) {
      if (seen[o.id]) return;
      seen[o.id] = 1;
      if (o.y < Y0) baseN++; else per[o.y - Y0]++;
    });
    META.stats.perYear = per; META.stats.base = baseN;
    cum = [];
    per.forEach(function (n) { acc += n; cum.push(acc); });
    maxPerYear = Math.max.apply(null, per) || 1;
  }
  recomputeStats();

  // ---------- состояние ----------
  var v = T0;                 // положение на шкале времени (дробное)
  var playing = false, attract = false, anim = null, dirty = true;
  var selected = null;        // выбранный объект справочника
  var editSel = [], selVer = 0, undoStack = [];   // режим правки: выбранные здания, счётчик перерисовки, история
  var lastYear = -1, lastBuilt = -1, lastInput = performance.now(), pauseUntil = 0;
  var is3d = true;
  var CALM_MS = 20000, calm = false;      // через 20 секунд без касаний интерфейс уходит, остаётся город

  var VIEWS = {
    start: { longitude: 45.702, latitude: 43.3135, zoom: 12.7, pitch: 50, bearing: -14 },
    city: { longitude: 45.668, latitude: 43.312, zoom: 11.75, pitch: 32, bearing: 0 },
    center: { longitude: 45.6965, latitude: 43.3168, zoom: 14.6, pitch: 58, bearing: -24 }
  };
  var LIMITS = { minZoom: 10.2, maxZoom: 19.5, maxPitch: 68, minPitch: 0 };
  var cur = Object.assign({}, VIEWS.start, LIMITS);
  (function () {
    var m = /[?&]view=([-\d.,]+)/.exec(location.search), y = /[?&]year=(\d{4})/.exec(location.search);
    if (m) {
      var a = m[1].split(',').map(Number);
      if (a.length >= 3 && a.every(isFinite)) cur = Object.assign(cur, { longitude: a[0], latitude: a[1], zoom: a[2], pitch: a[3] || 0, bearing: a[4] || 0 });
    }
    if (y) v = clamp(+y[1], T0, T1);
  })();

  var yearOf = function (t) { return clamp(Math.ceil(t - 1e-9), Y0, Y1); };
  var ease = function (x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };

  // ---------- карта ----------
  var light = new D.LightingEffect({
    ambient: new D.AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
    sun: new D.DirectionalLight({ color: [255, 244, 228], intensity: 1.7, direction: [-2, -3.5, -2.2] }),
    sky: new D.DirectionalLight({ color: [170, 195, 255], intensity: 0.55, direction: [3, 1.5, -1] })
  });
  var MATERIAL = { ambient: 0.38, diffuse: 0.72, shininess: 10, specularColor: [30, 34, 44] };

  var deckgl = new D.DeckGL({
    container: 'map',
    map: false,
    views: new D.MapView({ repeat: false }),
    initialViewState: cur,
    controller: { dragRotate: true, touchRotate: true, inertia: 300, doubleClickZoom: true, keyboard: false },
    effects: [light],
    useDevicePixels: Math.min(window.devicePixelRatio || 1, 1.5),
    pickingRadius: 8,
    layers: [],
    getCursor: function (s) { return s.isDragging ? 'grabbing' : s.isHovering ? 'pointer' : 'grab'; },
    getTooltip: function (info) {
      var o = info.object;
      if (!o || !info.layer) return null;
      if (info.layer.id.indexOf('lm-') === 0) return { text: o.name + ' · ' + o.year };
      if (info.layer.id.indexOf('model-') === 0) return { text: o.lm };
      if (info.layer.id.charAt(0) === 'b') return { text: (o.n || o.t || 'Здание') + ' · ' + whenShort(o) };
      return null;
    },
    onClick: function (info, ev) {
      touch();
      var o = info.object;
      if (EDIT) {
        editClick(o && info.layer && info.layer.id.charAt(0) === 'b' ? o : null, !!(ev && ev.srcEvent && ev.srcEvent.shiftKey));
        return;
      }
      if (o && info.layer && info.layer.id.indexOf('lm-') === 0) { select(o, false); return; }
      if (o && info.layer && info.layer.id.indexOf('model-') === 0) {
        var ml = LM.filter(function (l) { return l.short === o.lm; })[0];
        if (ml) select(ml, false);
        return;
      }
      if (o && info.layer && info.layer.id.charAt(0) === 'b') { selected = null; showBuilding(o); dirty = true; return; }
      selected = null; hideCard(); dirty = true;
    },
    onViewStateChange: function (e) {
      var z0 = cur.zoom;
      cur = e.viewState;
      if (e.interactionState && (e.interactionState.isDragging || e.interactionState.isZooming || e.interactionState.isRotating)) touch();
      dirty = true;
    },
    onError: function (err, layer) {
      // если видеокарта не приняла шейдер фасадов — рисуем здания по-старому, без окон
      if (useFacade && layer && layer.id && layer.id.charAt(0) === 'b') { useFacade = facadeOk = false; dirty = true; return; }
      if (layer && layer.id && layer.id.indexOf('model-') === 0) { MODELS.length = 0; dirty = true; return; }
      if (window.console) console.error(err);
    },
    onLoad: function () {
      var el = $('loading');
      el.classList.add('done');
      setTimeout(function () { el.hidden = true; }, 900);
    }
  });

  function flyTo(view, ms) {
    cur = Object.assign({}, cur, LIMITS, view, {
      transitionDuration: ms || 2200,
      transitionInterpolator: new D.FlyToInterpolator({ speed: 1.3 })
    });
    deckgl.setProps({ initialViewState: cur });
  }

  var GROUND = { depthTest: false };
  var poly = function (id, data, color, extra) {
    return new D.SolidPolygonLayer(Object.assign({ id: id, data: data, getPolygon: function (d) { return d; }, getFillColor: color,
      extruded: false, parameters: GROUND }, extra || {}));
  };
  var path = function (id, data, color, w, minPx, extra) {
    return new D.PathLayer(Object.assign({ id: id, data: data, getPath: function (d) { return d; }, getColor: color, getWidth: w,
      widthUnits: 'meters', widthMinPixels: minPx, capRounded: true, jointRounded: true, parameters: GROUND }, extra || {}));
  };

  // слои подложки не зависят от времени — создаём один раз
  var groundLayers = [
    poly('city', cityPolys, [17, 25, 42]),
    poly('a-industrial', areas.industrial || [], [21, 28, 44]),
    poly('a-green', areas.green || [], [15, 37, 33]),
    poly('a-cemetery', areas.cemetery || [], [18, 33, 34]),
    poly('a-park', areas.park || [], [19, 52, 40]),
    poly('a-sport', areas.sport || [], [22, 58, 46]),
    path('rivers', rivers, [24, 62, 104], function (d) { return d.t === 'river' ? 26 : 8; }, 1, { getPath: function (d) { return d.p; } }),
    poly('a-water', areas.water || [], [20, 56, 96]),
    path('district-lines', districtLines, [120, 140, 180, 60], 14, 1),
    path('city-line', cityLines, [246, 196, 83, 120], 30, 1.5),
    path('rail', roadsByClass[5], [70, 78, 98], 4, 0.6),
    path('r3', roadsByClass[3], [36, 46, 68], 6, 0.5),
    path('r2', roadsByClass[2], [48, 60, 86], 9, 0.9),
    path('r1', roadsByClass[1], [60, 74, 104], 12, 1.3),
    path('r0', roadsByClass[0], [78, 94, 128], 15, 1.8)
  ];


  // ---------- оформление: фасады с окнами, огни, свечение ----------
  // index.html?simple отключает эффекты (для слабых компьютеров)
  var FX = !/[?&]simple\b/.test(location.search);
  var facadeOk = FX;           // сбрасывается, если видеокарта не приняла шейдер фасадов
  var useFacade = FX;
  // Уровни качества: 0 — всё; 1 — без деревьев и огней машин; 2 — ещё без крыш и ореолов, обычная чёткость;
  // 3 — ещё без окон на фасадах. Карта сама меняет уровень по числу кадров в секунду; index.html?quality=N задаёт уровень вручную.
  var Q = { level: 0, trees: FX, traffic: FX, roofs: FX, glow: FX, fixed: false };
  function setQuality(lv) {
    Q.level = lv;
    Q.trees = FX && lv < 1; Q.traffic = FX && lv < 1; Q.roofs = FX && lv < 2; Q.glow = FX && lv < 2;
    useFacade = facadeOk && lv < 3;
    if (typeof deckgl !== 'undefined') deckgl.setProps({ useDevicePixels: lv >= 2 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5) });
    layerCache = {}; dirty = true;
  }
  var ADD = { blend: true, blendFunc: [770, 1], depthTest: false };          // сложение цветов: свет поверх картинки

  // Фасады рисуются прямо в шейдере зданий: стена делится на этажи (3,1 м) и оконные ячейки (~3,3 м),
  // часть окон «горит». Вдали, где окно меньше пикселя, рисунок плавно заменяется средним цветом.
  var FACADE_DECL = 'varying vec4 vFacade;\nvarying vec2 vFacade2;';
  var FACADE_VS = [
    'float fcH = props.elevations * elevationScale * gG;',
    'float fcPpm = project_size_to_pixel(1.0) * project_uFocalDistance / max(gl_Position.w, 0.0001);',
    '#ifdef IS_SIDE_VERTEX',
    '  vec2 fcD = (props.nextPositions.xy - props.positions.xy) + (props.nextPositions64Low.xy - props.positions64Low.xy);',
    '  float fcL = length(fcD * vec2(81000.0, 110574.0));',
    '  float fcCells = fcL < 2.6 ? 0.0 : max(1.0, floor(fcL / 3.3 + 0.5));',
    '  vFacade = vec4(vertexPositions.x * fcCells, fcH * vertexPositions.y, 1.0, fcH);',
    '  vFacade2 = vec2(fract(sin(dot(fract(props.positions.xy * 917.0), vec2(12.9898, 78.233))) * 43758.5453), fcPpm);',
    '#else',
    '  vFacade = vec4(0.0, fcH, 0.0, fcH);',
    '  vFacade2 = vec2(0.0, fcPpm);',
    '#endif'
  ].join('\n');
  var FACADE_FS = [
    'if (uFacade > 0.0) {',
    '  if (vFacade.z > 0.5) {',
    '    float fl = vFacade.y / 3.1;',
    '    vec2 f = vec2(fract(vFacade.x), fract(fl));',
    '    vec2 id = vec2(floor(vFacade.x), floor(fl));',
    '    float inFloor = step(vFacade.y, vFacade.w - 1.4);',
    '    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78) * inFloor;',
    '    float rnd = fract(sin(dot(id + vFacade2.x * 57.0, vec2(12.9898, 78.233))) * 43758.5453);',
    '    float solid = step(0.9, color.a);',
    '    float lit = step(1.0 - vGLit, rnd) * solid;',
    '    vec3 lamp = mix(vec3(1.0, 0.80, 0.48), vec3(0.78, 0.90, 1.0), step(0.86, fract(rnd * 7.31)));',
    '    vec3 glass = mix(color.rgb * 0.36 + vec3(0.015, 0.025, 0.05), lamp, lit);',
    '    float band = step(0.93, f.y) * inFloor;',
    '    vec3 detailed = mix(color.rgb * (1.0 - 0.16 * band), glass, win);',
    '    vec3 far = mix(color.rgb, mix(color.rgb * 0.4, vec3(1.0, 0.80, 0.48), vGLit * solid), 0.24);',
    '    float k = smoothstep(0.32, 0.95, vFacade2.y);',
    '    color.rgb = mix(color.rgb, mix(far, detailed, k), uFacade);',
    '  } else {',
    '    color.rgb *= mix(1.0, 0.8, uFacade);',
    '  }',
    '}'
  ].join('\n');

  // Рост и вспышку зданий считает видеокарта. Каждому зданию (и каждой грани крыши) заранее передаётся атрибут growth:
  // x — год постройки (-1000 — до 2000 года, 1e6 — не показывать), y — сила вспышки, z — яркость золота, w — 1 у новостроек
  // (окна горят ярче). Программе остаётся сообщить одно число — текущее время на шкале (uTime).
  function growVS(vs) {
    var side = vs.indexOf('#define IS_SIDE_VERTEX') >= 0, attr = side ? 'instanceGrowth' : 'growth';
    var a = vs;
    a = a.replace('void calculatePosition(PolygonProps props) {', [
      'attribute vec4 ' + attr + ';',
      'uniform float uTime;',
      'uniform float uCull;',
      'float gG;',
      'float gFlash;',
      'varying float vGLit;',
      'void calculatePosition(PolygonProps props) {',
      '  vec4 gw = ' + attr + ';',
      '  float gx = clamp(uTime - gw.x + 1.0, 0.0, 1.0);',
      '  gG = 1.0 - (1.0 - gx) * (1.0 - gx) * (1.0 - gx);',            // как ease() в программе
      '  gFlash = clamp(1.0 - (uTime - gw.x) / 1.6, 0.0, 1.0);',        // свежепостроенное светится и «остывает»
      '  vGLit = mix(0.2, 0.3 + 0.5 * gFlash, gw.w);',
      '  if (gG < uCull) { gl_Position = vec4(0.0); return; }'          // ещё не построено — не рисуем
    ].join('\n'));
    a = a.replace('vec4 colors = isWireframe ? props.lineColors : props.fillColors;',
      'vec4 colors = isWireframe ? props.lineColors : props.fillColors;\n  colors.rgb = mix(colors.rgb, vec3(1.0, 0.745, 0.353) * gw.z, gFlash * gw.y);');
    a = a.replace('pos.z += props.elevations * vertexPositions.y * elevationScale;',
      'pos.z += props.elevations * vertexPositions.y * elevationScale * gG;');
    a = a.replace('  pos = props.positions;\n', '  pos = props.positions;\n  pos.z *= gG;\n');   // крыши: поднимаются вместе со стенами
    if (a === vs || a.indexOf('* gG;') < 0) throw new Error('шейдер зданий: не удалось встроить рост');
    return a;
  }
  class GrowLayer extends D.SolidPolygonLayer {
    initializeState() {
      super.initializeState();
      this.getAttributeManager().add({
        growth: { size: 4, accessor: 'getGrowth', defaultValue: [-1000, 0, 0, 0],
          shaderAttributes: { growth: { divisor: 0 }, instanceGrowth: { divisor: 1 } } }
      });
    }
    getShaders(type) {
      var sh = super.getShaders(type);
      sh.vs = growVS(sh.vs);
      return sh;
    }
    draw(opts) {
      opts.uniforms = Object.assign({}, opts.uniforms, { uTime: this.props.time, uCull: this.props.cull });
      super.draw(opts);
    }
  }
  GrowLayer.layerName = 'GrowLayer';
  GrowLayer.defaultProps = { time: { type: 'number', value: 1e5 }, cull: { type: 'number', value: 0.001 },
    getGrowth: { type: 'accessor', value: [-1000, 0, 0, 0] } };

  class FacadeLayer extends GrowLayer {
    getShaders(type) {
      var sh = super.getShaders(type);
      sh.inject = Object.assign({}, sh.inject, {
        'vs:#decl': FACADE_DECL,
        'vs:#main-end': FACADE_VS,
        'fs:#decl': FACADE_DECL + '\nuniform float uFacade;\nvarying float vGLit;',
        'fs:DECKGL_FILTER_COLOR': FACADE_FS
      });
      return sh;
    }
    draw(opts) {
      opts.uniforms = Object.assign({}, opts.uniforms, { uFacade: this.props.facade });
      super.draw(opts);
    }
  }
  FacadeLayer.layerName = 'FacadeLayer';
  FacadeLayer.defaultProps = { facade: { type: 'number', value: 1 } };

  // потоки машин: по каждой крупной улице в обе стороны бегут огни (белые — навстречу, красные — вслед)
  var TRIP_P = 16, trips = [];
  (function () {
    var KX = 81000, KY = 110574;
    [0, 1, 2].forEach(function (cls) {
      var speed = cls === 0 ? 16 : cls === 1 ? 13 : 10;
      roadsByClass[cls].forEach(function (path, idx) {
        var cumd = [0], L = 0, i, n = path.length;
        for (i = 1; i < n; i++) { L += Math.hypot((path[i][0] - path[i - 1][0]) * KX, (path[i][1] - path[i - 1][1]) * KY); cumd.push(L); }
        var rnd = ((idx * 2654435761 + cls * 97) >>> 0) % 1000 / 1000;
        if (L < 80 || (cls === 2 && rnd > 0.6)) return;
        var dur = L / speed;
        for (var dir = 0; dir < 2; dir++) {
          var pts = [], off = (dir ? -1 : 1) * 3.2;          // своя полоса: 3,2 м вправо по ходу
          for (i = 0; i < n; i++) {
            var a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, n - 1)];
            var dx = (b[0] - a[0]) * KX, dy = (b[1] - a[1]) * KY, len = Math.hypot(dx, dy) || 1;
            pts.push([path[i][0] + dy / len * off / KX, path[i][1] - dx / len * off / KY, 1]);
          }
          var times = cumd.map(function (d) { return d / speed; });
          if (dir) { pts.reverse(); times = cumd.map(function (d) { return (L - d) / speed; }).reverse(); }
          var t0 = ((rnd * 7.13 + dir * 0.37) % 1) * TRIP_P;
          for (var k = -Math.ceil((dur + 3) / TRIP_P); k <= 0; k++) {
            trips.push({ p: pts, t: times.map(function (x) { return x + t0 + k * TRIP_P; }), d: dir });
          }
        }
      });
    });
  })();
  var trafficOn = function () { return Q.traffic && !EDIT && cur.zoom >= 12.3; };

  // мягкое пятно света для ореолов
  var GLOW = (function () {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,255,255,.42)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c.toDataURL();
  })();
  var GLOW_MAP = { g: { x: 0, y: 0, width: 128, height: 128, mask: true } };


  // ---------- объёмные модели главных символов ----------
  // Модели собираются из простых тел (призмы, купола, шпили) по реальным контурам зданий из OpenStreetMap.
  // Координаты — метры на восток, север и вверх от опорной точки модели.
  var useModels = FX && typeof D.SimpleMeshLayer === 'function';
  var MKX = 81000, MKY = 110574;

  function MeshBuilder(angleDeg) {
    this.p = []; this.n = []; this.c = [];
    var a = (angleDeg || 0) * Math.PI / 180;
    this.ca = Math.cos(a); this.sa = Math.sin(a);
  }
  MeshBuilder.prototype.rot = function (q) { return [q[0] * this.ca - q[1] * this.sa, q[0] * this.sa + q[1] * this.ca, q[2]]; };
  MeshBuilder.prototype.tri = function (a, b, c, col, na, nb, nc) {
    if (!na) {
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      na = nb = nc = [nx / l, ny / l, nz / l];
    }
    var pts = [a, b, c], nrm = [na, nb, nc];
    for (var i = 0; i < 3; i++) {
      var q = this.rot(pts[i]), m = this.rot(nrm[i]);
      this.p.push(q[0], q[1], q[2]); this.n.push(m[0], m[1], m[2]); this.c.push(col[0], col[1], col[2]);
    }
  };
  MeshBuilder.prototype.quad = function (a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); };
  // призма по контуру: стены от z0 до z1 и крышка
  MeshBuilder.prototype.extrude = function (ring, z0, z1, col, capCol) {
    var area = 0, n = ring.length, i, cx = 0, cy = 0;
    for (i = 0; i < n; i++) { var a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; cx += a[0]; cy += a[1]; }
    if (area < 0) ring = ring.slice().reverse();
    cx /= n; cy /= n;
    for (i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], col);
      this.tri([cx, cy, z1], [p[0], p[1], z1], [q[0], q[1], z1], capCol || col);
    }
  };
  MeshBuilder.prototype.walls = function (ring, z0, z1, col) {
    var area = 0, n = ring.length, i;
    for (i = 0; i < n; i++) { var a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) ring = ring.slice().reverse();
    for (i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], col);
    }
  };
  MeshBuilder.prototype.cap = function (ring, z, col) {
    var area = 0, n = ring.length, i, cx = 0, cy = 0;
    for (i = 0; i < n; i++) { var a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; cx += a[0]; cy += a[1]; }
    if (area < 0) ring = ring.slice().reverse();
    cx /= n; cy /= n;
    for (i = 0; i < n; i++) { var p = ring[i], q = ring[(i + 1) % n]; this.tri([cx, cy, z], [p[0], p[1], z], [q[0], q[1], z], col); }
  };
  // брус между двумя точками на плане (для стрел кранов): ширина w, от z0 до z1
  MeshBuilder.prototype.beam = function (a, b, w, z0, z1, col) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
    this.extrude([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], z0, z1, col);
  };
  // усечённая призма с n гранями: радиус r0 внизу и r1 вверху (r1 = 0 — шпиль)
  MeshBuilder.prototype.frustum = function (x, y, z0, z1, r0, r1, n, col) {
    for (var i = 0; i < n; i++) {
      var a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
      var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      var p00 = [x + r0 * c0, y + r0 * s0, z0], p10 = [x + r0 * c1, y + r0 * s1, z0];
      var p01 = [x + r1 * c0, y + r1 * s0, z1], p11 = [x + r1 * c1, y + r1 * s1, z1];
      if (r1 > 0) { this.quad(p00, p10, p11, p01, col); this.tri([x, y, z1], p01, p11, col); }
      else this.tri(p00, p10, [x, y, z1], col);
    }
  };
  // купол: полусфера радиуса r и высоты h со сглаженными нормалями
  MeshBuilder.prototype.dome = function (x, y, z0, r, h, col, seg, rings) {
    seg = seg || 14; rings = rings || 5;
    var pt = function (i, j) {
      var th = 2 * Math.PI * i / seg, ph = Math.PI / 2 * j / rings, cp = Math.cos(ph), sp = Math.sin(ph);
      var nx = cp * Math.cos(th) * h, ny = cp * Math.sin(th) * h, nz = sp * r, l = Math.hypot(nx, ny, nz) || 1;
      return { p: [x + r * cp * Math.cos(th), y + r * cp * Math.sin(th), z0 + h * sp], n: [nx / l, ny / l, nz / l] };
    };
    for (var j = 0; j < rings; j++) {
      for (var i = 0; i < seg; i++) {
        var a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        this.tri(a.p, b.p, c.p, col, a.n, b.n, c.n);
        if (j < rings - 1) this.tri(a.p, c.p, d.p, col, a.n, c.n, d.n);
      }
    }
  };
  MeshBuilder.prototype.mesh = function () {
    return { attributes: {
      positions: { value: new Float32Array(this.p), size: 3 },
      normals: { value: new Float32Array(this.n), size: 3 },
      colors: { value: new Float32Array(this.c), size: 3 }
    } };
  };
  var rect = function (x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; };

  // Мечеть «Сердце Чечни». Ось здания повёрнута на 16,2° — вся модель строится в осях зала (u — поперёк, w — вдоль).
  function buildMosque() {
    var m = new MeshBuilder(-16.2);
    var STONE = [0.96, 0.94, 0.89], STONE2 = [0.84, 0.81, 0.75], LEAD = [0.70, 0.75, 0.83], GOLD = [1.0, 0.80, 0.36];
    var cu = -0.2, cw = -40;                                   // центр молельного зала
    m.extrude(rect(-21.9, -58.4, 21.5, -21.4), 7, 15.5, STONE);   // зал над цоколем
    m.extrude(rect(-15.2, -55, 14.8, -25), 15.5, 19.5, STONE);    // второй ярус
    [[-18.5, -55], [18.1, -55], [-18.5, -24.8], [18.1, -24.8]].forEach(function (q) {     // угловые купола
      m.frustum(q[0], q[1], 15.5, 16.9, 3.2, 3.2, 10, STONE2);
      m.dome(q[0], q[1], 16.9, 3.2, 3.0, LEAD, 10, 4);
    });
    [[-13.6, 0], [13.6, 0], [0, -13.6], [0, 13.6]].forEach(function (q) {                  // полукупола по сторонам
      m.dome(cu + q[0], cw + q[1], 16.2, 7.6, 6.6, LEAD, 14, 5);
    });
    m.frustum(cu, cw, 19.5, 23, 9.6, 9.6, 20, STONE2);         // барабан
    m.dome(cu, cw, 23, 9.6, 9.2, LEAD, 20, 7);                 // главный купол, верх на 32 м
    m.frustum(cu, cw, 32, 36, 0.55, 0, 8, GOLD);
    [[-29.3, -45], [29.6, -45], [-29.3, -22.6], [29.9, -22.6]].forEach(function (q) {     // минареты, 62 м
      var x = q[0], y = q[1];
      m.frustum(x, y, 0, 16, 2.8, 2.3, 8, STONE);
      m.frustum(x, y, 16, 17.2, 3.3, 3.3, 10, STONE2);
      m.frustum(x, y, 17.2, 33, 2.0, 1.8, 10, STONE);
      m.frustum(x, y, 33, 34.1, 2.9, 2.9, 10, STONE2);
      m.frustum(x, y, 34.1, 46, 1.6, 1.5, 10, STONE);
      m.frustum(x, y, 46, 47, 2.5, 2.5, 10, STONE2);
      m.frustum(x, y, 47, 51, 1.3, 1.3, 10, STONE);
      m.frustum(x, y, 51, 61.5, 1.5, 0, 10, LEAD);
      m.frustum(x, y, 60.5, 63.5, 0.28, 0, 6, GOLD);
    });
    var k;
    for (k = 0; k < 7; k++) {                                   // купола галерей вокруг двора
      m.dome(-19.3, -7 + 5.6 * k, 7, 2.3, 2.0, LEAD, 8, 3);
      m.dome(19.0, -7 + 5.6 * k, 7, 2.3, 2.0, LEAD, 8, 3);
    }
    for (k = 0; k < 6; k++) m.dome(-13.5 + 5.4 * k, 33.3, 7, 2.3, 2.0, LEAD, 8, 3);
    m.extrude(rect(-8.0, 36.6, 8.0, 41.0), 7, 11, STONE);      // северный портал
    m.dome(0, 38.8, 11, 3.4, 3.0, LEAD, 10, 4);
    return m.mesh();
  }

  // Башни «Грозный-Сити» строятся целиком: стеклянный корпус по контуру из OpenStreetMap с полосой света на каждом этаже,
  // ступенчатые венчания и шпили. Исходные контуры остаются на карте низким основанием.
  var CITY_TOWERS = [['w251359497', 3], ['w251359499', 2], ['w1521411122', 2], ['w1521411124', 1], ['w1521411126', 1], ['w251359500', 0], ['w252195816', 0]];
  var CITY_ORIGIN = [45.6978, 43.3157];
  var toLocal = function (o, origin) { return o.p[0].slice(0, -1).map(function (q) { return [(q[0] - origin[0]) * MKX, (q[1] - origin[1]) * MKY]; }); };
  var centerOf = function (ring) {
    var cx = 0, cy = 0;
    ring.forEach(function (q) { cx += q[0]; cy += q[1]; });
    return [cx / ring.length, cy / ring.length];
  };
  var scaler = function (ring, c) { return function (f) { return ring.map(function (q) { return [c[0] + (q[0] - c[0]) * f, c[1] + (q[1] - c[1]) * f]; }); }; };
  function buildCity() {
    var m = new MeshBuilder(0);
    var GLASS = [0.20, 0.36, 0.55], GLASS2 = [0.16, 0.30, 0.48], BAND = [1.0, 0.84, 0.55], ROOF = [0.30, 0.34, 0.42];
    var CROWN = [0.24, 0.40, 0.60], LAMP = [1.0, 0.90, 0.68], LEAD = [0.70, 0.76, 0.84];
    CITY_TOWERS.forEach(function (t) {
      var o = byId[t[0]] && byId[t[0]][0];
      if (!o) return;
      var ring = toLocal(o, CITY_ORIGIN), c = centerOf(ring), sc = scaler(ring, c), cx = c[0], cy = c[1];
      var h = o.h, kind = t[1], FL = 3.6, z = 0, k = 0;
      while (z < h - 0.5) {
        var z1 = Math.min(h, z + FL);
        m.walls(ring, z, z1 - 0.45, k % 2 ? GLASS : GLASS2);
        m.walls(ring, z1 - 0.45, z1, BAND);
        z = z1; k++;
      }
      m.cap(ring, h, ROOF);
      if (kind >= 2) {
        m.extrude(sc(0.8), h, h + 6, CROWN);
        m.extrude(sc(0.58), h + 6, h + 12, CROWN);
        m.extrude(sc(0.34), h + 12, h + 17, LAMP);
        m.frustum(cx, cy, h + 17, h + 17 + (kind === 3 ? 26 : 16), 1.7, 0, 8, LEAD);
      } else if (kind === 1) {
        m.extrude(sc(0.8), h, h + 5, CROWN);
        m.extrude(sc(0.5), h + 5, h + 10, LAMP);
      } else {
        m.extrude(sc(0.86), h, h + 4, CROWN);
        m.extrude(sc(0.6), h + 4, h + 7, LAMP);
      }
    });
    return m.mesh();
  }

  // «Ахмат Тауэр» не достроен: каркас перекрытий с колоннами и ядром, два башенных крана с красными огнями
  // и едва заметный силуэт проектной высоты (435 м).
  var AHMAT = 'w934823149', AHMAT_H = 435;
  function buildAhmat(ghost) {
    var o = byId[AHMAT][0], m = new MeshBuilder(0);
    var ring = toLocal(o, o.c), c = centerOf(ring), sc = scaler(ring, c), H = Math.max(24, o.h);
    if (ghost) {
      var N = 14, prevF = 0.6;                                  // башня уже подиума, сужается кверху
      for (var i = 0; i < N; i++) {
        var f1 = 0.6 - 0.32 * Math.pow((i + 1) / N, 1.6);
        m.walls(sc(prevF), H + (AHMAT_H - H) * i / N, H + (AHMAT_H - H) * (i + 1) / N, [1, 1, 1]);
        prevF = f1;
      }
      m.frustum(c[0], c[1], AHMAT_H, AHMAT_H + 30, 2, 0, 8, [1, 1, 1]);
      return m.mesh();
    }
    var CONC = [0.62, 0.62, 0.60], CONC2 = [0.44, 0.44, 0.44], CRANE = [1.0, 0.74, 0.16], STEEL = [0.36, 0.38, 0.42], RED = [1.0, 0.10, 0.06];
    var inner = sc(0.9);
    for (var z = 0; z < H; z += 4) {
      m.extrude(sc(1), z, z + 0.5, CONC);
      if (z + 4 <= H) {
        inner.forEach(function (q) { m.frustum(q[0], q[1], z + 0.5, z + 4, 0.7, 0.7, 4, CONC2); });
        m.extrude(sc(0.36), z + 0.5, z + 4, CONC2);
      }
    }
    var n = ring.length;
    [[ring[0], 30], [ring[Math.floor(n / 2)], 200]].forEach(function (pc, idx) {
      var p = [c[0] + (pc[0][0] - c[0]) * 1.12, c[1] + (pc[0][1] - c[1]) * 1.12], top = H + 26 + idx * 9;
      var a = pc[1] * Math.PI / 180, dir = [Math.cos(a), Math.sin(a)];
      m.frustum(p[0], p[1], 0, top, 2.0, 2.0, 4, CRANE);                                   // мачта
      m.beam([p[0] - dir[0] * 14, p[1] - dir[1] * 14], [p[0] + dir[0] * 48, p[1] + dir[1] * 48], 1.4, top, top + 1.6, CRANE);   // стрела
      m.beam([p[0] - dir[0] * 14, p[1] - dir[1] * 14], [p[0] - dir[0] * 9, p[1] - dir[1] * 9], 2.6, top - 3, top, STEEL);      // противовес
      m.extrude(rect(p[0] - 1.6, p[1] - 1.6, p[0] + 1.6, p[1] + 1.6), top - 3.2, top, STEEL);                                   // кабина
      m.frustum(p[0], p[1], top + 1.6, top + 6, 0.5, 0, 6, CRANE);
      m.frustum(p[0], p[1], top + 6, top + 7.2, 0.6, 0.6, 6, RED);                          // огни
      m.frustum(p[0] + dir[0] * 48, p[1] + dir[1] * 48, top + 1.6, top + 2.8, 0.6, 0.6, 6, RED);
    });
    return m.mesh();
  }

  // Стадион «Ахмат Арена»: освещённое поле с полосами газона и разметкой, чаша трибун, наружный фасад
  // и белый козырёк над трибунами. Размеры чаши — по двум контурам трибун из OpenStreetMap (восточная и западная части).
  var ARENA = 'w400832527', ARENA_W = 'w400832525';
  function buildArena() {
    var m = new MeshBuilder(0);
    var cx = -24, cy = -3;                                            // центр поля относительно контура восточной трибуны
    var se = function (a, b, t, z) {                                  // точка «скруглённого прямоугольника» (суперэллипс)
      var c = Math.cos(t), s = Math.sin(t), e = 0.5;
      return [cx + a * Math.sign(c) * Math.pow(Math.abs(c), e), cy + b * Math.sign(s) * Math.pow(Math.abs(s), e), z];
    };
    var N = 64, i;
    var band = function (a0, b0, z0, a1, b1, z1, col) {
      for (i = 0; i < N; i++) {
        var t0 = 2 * Math.PI * i / N, t1 = 2 * Math.PI * (i + 1) / N;
        m.quad(se(a0, b0, t0, z0), se(a0, b0, t1, z0), se(a1, b1, t1, z1), se(a1, b1, t0, z1), col);
      }
    };
    var GRASS = [0.30, 0.72, 0.34], GRASS2 = [0.26, 0.64, 0.30], LINE = [0.95, 0.97, 0.95], APRON = [0.20, 0.42, 0.26];
    var SEAT = [0.30, 0.40, 0.52], SEAT2 = [0.24, 0.32, 0.44], FACADE = [0.90, 0.91, 0.93], GLOW = [1.0, 0.92, 0.72], ROOF = [0.94, 0.95, 0.97];
    // площадка вокруг поля и поле 68 × 105 м с полосами
    // площадка вокруг поля — рамкой, без наложения на газон (иначе при отдалении газон «тонет» в ней)
    m.cap(rect(cx - 47, cy - 66, cx + 47, cy - 52.5), 0.3, APRON); m.cap(rect(cx - 47, cy + 52.5, cx + 47, cy + 66), 0.3, APRON);
    m.cap(rect(cx - 47, cy - 52.5, cx - 34, cy + 52.5), 0.3, APRON); m.cap(rect(cx + 34, cy - 52.5, cx + 47, cy + 52.5), 0.3, APRON);
    for (i = 0; i < 14; i++) m.cap(rect(cx - 34, cy - 52.5 + 7.5 * i, cx + 34, cy - 45 + 7.5 * i), 0.3, i % 2 ? GRASS : GRASS2);
    var line = function (x0, y0, x1, y1) { m.cap(rect(Math.min(x0, x1) - 0.3, Math.min(y0, y1) - 0.3, Math.max(x0, x1) + 0.3, Math.max(y0, y1) + 0.3), 1.0, LINE); };
    line(cx - 34, cy - 52.5, cx + 34, cy - 52.5); line(cx - 34, cy + 52.5, cx + 34, cy + 52.5);
    line(cx - 34, cy - 52.5, cx - 34, cy + 52.5); line(cx + 34, cy - 52.5, cx + 34, cy + 52.5);
    line(cx - 34, cy, cx + 34, cy);
    [-1, 1].forEach(function (sg) {
      var y0 = cy + sg * 52.5, y1 = cy + sg * (52.5 - 16.5);
      line(cx - 20.15, y0, cx - 20.15, y1); line(cx + 20.15, y0, cx + 20.15, y1); line(cx - 20.15, y1, cx + 20.15, y1);
    });
    for (i = 0; i < 24; i++) {                                         // центральный круг
      var a0 = 2 * Math.PI * i / 24, a1 = 2 * Math.PI * (i + 1) / 24;
      line(cx + 9.15 * Math.cos(a0), cy + 9.15 * Math.sin(a0), cx + 9.15 * Math.cos(a1), cy + 9.15 * Math.sin(a1));
    }
    // чаша: нижний и верхний ярусы с проходом между ними
    band(50, 70, 1.5, 72, 90, 13, SEAT);
    band(72, 90, 13, 76, 94, 13, [0.5, 0.52, 0.56]);
    band(76, 94, 13, 96, 113, 27, SEAT2);
    band(50, 70, 0, 50, 70, 1.5, [0.6, 0.62, 0.66]);
    // наружный фасад с полосой подсветки
    band(102, 119, 0, 102, 119, 24, FACADE);
    band(102, 119, 24, 102, 119, 26, GLOW);
    band(102, 119, 26, 102, 119, 30, FACADE);
    band(96, 113, 27, 102, 119, 30, [0.5, 0.52, 0.56]);
    // козырёк: от фасада к внутренней кромке над первыми рядами, снизу — светлая подшивка
    band(104, 121, 31, 64, 83, 35, ROOF);
    band(64, 83, 35, 104, 121, 31.6, [0.70, 0.72, 0.76]);
    band(64, 83, 35, 64, 83, 33.8, GLOW);                              // прожекторы по кромке
    return m.mesh();
  }

  // bid — здание, с которым модель растёт; year — год, если он не совпадает с годом здания; lm — объект справочника, открываемый по щелчку
  var MODEL_MATERIAL = { ambient: 0.62, diffuse: 0.62, shininess: 24, specularColor: [70, 70, 70] };
  var LIT_MATERIAL = { ambient: 0.74, diffuse: 0.5, shininess: 40, specularColor: [80, 80, 80] };      // подсвеченные ночью
  var MODELS = !useModels ? [] : [
    { id: 'model-mosque', bid: 'r6012185', lm: 'Сердце Чечни', origin: [45.69407768, 43.31801782], mk: buildMosque, material: LIT_MATERIAL },
    { id: 'model-city', bid: 'w251359497', lm: 'Грозный-Сити', origin: CITY_ORIGIN, mk: buildCity, material: LIT_MATERIAL },
    { id: 'model-arena', bid: ARENA, lm: 'Ахмат Арена', mk: buildArena, material: LIT_MATERIAL },
    { id: 'model-ahmat', bid: AHMAT, lm: 'Ахмат Тауэр', year: 2016, mk: function () { return buildAhmat(false); }, material: MODEL_MATERIAL },
    { id: 'model-ahmat-ghost', bid: AHMAT, lm: 'Ахмат Тауэр', year: 2016, ghost: 1, mk: function () { return buildAhmat(true); } }
  ].filter(function (md) { return byId[md.bid]; }).map(function (md) {
    if (!md.origin) md.origin = byId[md.bid][0].c;
    md.mesh = md.mk();
    return md;
  });
  // контуры под моделями остаются низким основанием
  if (useModels) {
    if (byId.r6012185) byId.r6012185.forEach(function (o) { o.h = 7; o.mdl = 1; });
    CITY_TOWERS.forEach(function (t) { (byId[t[0]] || []).forEach(function (o) { o.h = 1.5; o.mdl = 1; }); });
    (byId[AHMAT] || []).forEach(function (o) { o.h = 0.6; o.mdl = 1; });
    [ARENA, ARENA_W].forEach(function (id) { (byId[id] || []).forEach(function (o) { o.h = 0.5; o.mdl = 1; }); });
  }

  var FLOOD = { 'Сердце Чечни': 330, 'Грозный-Сити': 380, 'Ахмат Арена': 460 };
  // корпуса ЧГУ: светлый камень и фирменная голубая светящаяся кромка по крыше — университет узнаётся с любого ракурса
  var UNI_WALL = [214, 224, 238];
  var UNI = ALL.filter(function (o) { return o.u; }), uniCache = { k: '', d: [] };
  function uniBuilt() {
    var d = UNI.filter(function (o) { return o.y < Y0 || ease(v - (o.y - 1)) > 0.97; });
    var k = d.map(function (o) { return o.id; }).join();
    if (k !== uniCache.k) uniCache = { k: k, d: d };
    return uniCache.d;
  }
  var SEL_COLOR = [255, 70, 200, 255];
  // Цвет стены здания без вспышки; вспышку по году постройки добавляет видеокарта (wallGrowth).
  var yearColors = {};
  function wallColor(d) {
    if (d.sel) return SEL_COLOR;
    if (d.mdl) return [226, 216, 192, 255];
    if (d.u) return [UNI_WALL[0], UNI_WALL[1], UNI_WALL[2], 255];
    if (d.s === 'k') return [214, 220, 235, 150];
    if (d.y < Y0) { var g = 0.86 + d.j * 0.28; return [102 * g, 110 * g, 128 * g, 255]; }     // старая застройка: спокойнее новостроек, но не сливается с землёй
    // с фасадами стена темнее и спокойнее по цвету, чтобы горящие окна читались; год остаётся в оттенке
    var yc = yearColors[d.y] || (yearColors[d.y] = yearColor(d.y));
    var wall = useFacade ? mix([60, 62, 72], yc, 0.74) : yc, k = (useFacade ? 0.86 : 0.92) + d.j * 0.14;
    return [Math.min(255, wall[0] * k), Math.min(255, wall[1] * k), Math.min(255, wall[2] * k), 255];
  }
  function wallGrowth(d) {
    if (d.y < Y0) return [-1000, 0, 0, 0];
    if (d.sel || d.mdl || d.s === 'k') return [d.y, 0, 0, 1];
    if (d.u) return [d.y, 0.6, 1, 1];
    return [d.y, 0.85, (useFacade ? 0.86 : 0.92) + d.j * 0.14, 1];
  }

  // ---------- скатные крыши частных домов ----------
  // У небольших низких домов (до 300 м², до 8 м) над коробкой строится крыша: четырёхскатная по описанному прямоугольнику,
  // если дом близок к прямоугольнику, иначе шатровая по самому контуру. Грань крыши — отдельный многоугольник с высотой
  // в каждой вершине; освещённость грани считается заранее по её направлению к солнцу.
  var useRoofs = FX;      // отдельно от Q.roofs: при useRoofs = false крыши не строятся вовсе
  var ROOF_COLORS = [[128, 66, 52], [150, 84, 60], [96, 70, 60], [70, 98, 82], [104, 110, 118], [74, 90, 112], [136, 120, 100]];
  var SUN = (function () { var x = 2, y = 3.5, l = Math.hypot(x, y); return [x / l, y / l]; })();
  function convexHull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function makeRoof(o) {
    var r = o.p[0], n = r.length - 1, c0 = o.c[0], c1 = o.c[1], loc = [], i, area = 0;
    if (n < 3) return null;
    for (i = 0; i < n; i++) loc.push([(r[i][0] - c0) * MKX, (r[i][1] - c1) * MKY]);
    for (i = 0; i < n; i++) { var a = loc[i], b = loc[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    area = Math.abs(area) / 2;
    if (area < 12 || area > 300) return null;
    // прямоугольник наименьшей площади вокруг выпуклой оболочки
    var hull = convexHull(loc), best = null;
    for (i = 0; i < hull.length; i++) {
      var p = hull[i], q = hull[(i + 1) % hull.length], ex = q[0] - p[0], ey = q[1] - p[1], el = Math.hypot(ex, ey);
      if (el < 0.01) continue;
      var ux = ex / el, uy = ey / el, mnu = 1e9, mxu = -1e9, mnv = 1e9, mxv = -1e9;
      hull.forEach(function (h) {
        var pu = h[0] * ux + h[1] * uy, pv = -h[0] * uy + h[1] * ux;
        if (pu < mnu) mnu = pu; if (pu > mxu) mxu = pu; if (pv < mnv) mnv = pv; if (pv > mxv) mxv = pv;
      });
      var ra = (mxu - mnu) * (mxv - mnv);
      if (!best || ra < best.a) best = { a: ra, ux: ux, uy: uy, mnu: mnu, mxu: mxu, mnv: mnv, mxv: mxv };
    }
    if (!best) return null;
    var faces = [], toLL = function (x, y, z) { return [c0 + x / MKX, c1 + y / MKY, z]; };
    var face = function (pts, nx, ny) {                      // nx, ny — горизонтальное направление ската
      var l = Math.hypot(nx, ny) || 1, sh = 0.74 + 0.3 * ((nx / l) * SUN[0] + (ny / l) * SUN[1]);
      faces.push({ p: pts, sh: sh, o: o });
    };
    if (area / best.a > 0.8) {
      // четырёхскатная крыша со свесом 0,35 м
      var L = best.mxu - best.mnu, W = best.mxv - best.mnv, swap = W > L;
      var ux2 = swap ? -best.uy : best.ux, uy2 = swap ? best.ux : best.uy;           // u — вдоль длинной стороны
      var cu = (best.mnu + best.mxu) / 2, cv = (best.mnv + best.mxv) / 2;
      var cx = cu * best.ux - cv * best.uy, cy = cu * best.uy + cv * best.ux;
      if (swap) { var t = L; L = W; W = t; }
      L += 0.7; W += 0.7;
      var vx = -uy2, vy = ux2, rh = Math.min(3.4, Math.max(1.2, W * 0.27)), rl = (L - W) / 2;
      var P = function (su, sv, z) { return toLL(cx + ux2 * su + vx * sv, cy + uy2 * su + vy * sv, z); };
      var A = P(-L / 2, -W / 2, 0), B = P(L / 2, -W / 2, 0), C = P(L / 2, W / 2, 0), Dd = P(-L / 2, W / 2, 0);
      var R1 = P(-rl, 0, rh), R2 = P(rl, 0, rh);
      face([A, B, R2, R1], -vx, -vy);
      face([C, Dd, R1, R2], vx, vy);
      face([B, C, R2], ux2, uy2);
      face([Dd, A, R1], -ux2, -uy2);
    } else {
      // шатровая крыша по контуру
      var rh2 = Math.min(2.6, Math.max(1.0, Math.sqrt(area) * 0.2)), top = toLL(0, 0, rh2);
      for (i = 0; i < n; i++) {
        var a2 = loc[i], b2 = loc[(i + 1) % n], mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
        face([toLL(a2[0], a2[1], 0), toLL(b2[0], b2[1], 0), top], mx, my);
      }
    }
    return { faces: faces, col: ROOF_COLORS[Math.floor(o.j * 997) % ROOF_COLORS.length] };
  }
  // Крыши всего города хранятся сплошными массивами чисел: координаты вершин, начало каждой грани, цвет и год постройки
  // каждой вершины. Так на ~100 тысяч граней не заводятся сотни тысяч мелких объектов. Геометрия строится один раз;
  // после правок (год, выбор) пересчитываются только цвет и год.
  var roofGeo = null;
  function roofGeom() {
    if (roofGeo) return roofGeo;
    var pos = [], starts = [], own = [], sh = [], ci = [], nv = 0;
    ALL.forEach(function (o) {
      if (o.u || o.mdl || o.h > 8.5) return;
      var r = makeRoof(o);
      if (!r) return;
      var cidx = ROOF_COLORS.indexOf(r.col);
      r.faces.forEach(function (f) {
        starts.push(nv);
        f.p.concat([f.p[0]]).forEach(function (q) { pos.push(q[0], q[1], o.h + q[2]); nv++; });    // контур замкнут
        own.push(o); sh.push(f.sh); ci.push(cidx);
      });
    });
    return (roofGeo = { n: starts.length, nv: nv, starts: new Uint32Array(starts), pos: new Float64Array(pos), own: own,
      sh: new Float32Array(sh), ci: new Uint8Array(ci), key: '' });
  }
  function roofData() {
    var c = roofGeom(), key = selVer + '|' + groupVer;
    if (c.key === key) return c.data;
    var col = new Uint8Array(c.nv * 4), gr = new Float32Array(c.nv * 4);
    for (var f = 0; f < c.n; f++) {
      var o = c.own[f], s1 = f + 1 < c.n ? c.starts[f + 1] : c.nv, old = o.y < Y0, kk = c.sh[f] * (old ? 0.82 : 0.95);
      var rc = o.sel ? SEL_COLOR : ROOF_COLORS[c.ci[f]];
      var r = o.sel ? rc[0] : Math.min(255, rc[0] * kk), g = o.sel ? rc[1] : Math.min(255, rc[1] * kk), b = o.sel ? rc[2] : Math.min(255, rc[2] * kk);
      var y = o.s === 'k' ? 1e6 : old ? -1000 : o.y, fl = o.sel ? 0 : 0.8;
      for (var i = c.starts[f]; i < s1; i++) {
        col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 255;
        gr[i * 4] = y; gr[i * 4 + 1] = fl; gr[i * 4 + 2] = kk; gr[i * 4 + 3] = 0;
      }
    }
    c.key = key;
    c.data = { length: c.n, startIndices: c.starts, attributes: { getPolygon: { value: c.pos, size: 3 },
      getFillColor: { value: col, size: 4, normalized: true }, getGrowth: { value: gr, size: 4 } } };
    return c.data;
  }

  // ---------- деревья ----------
  // Положения деревьев — data/trees.js (tools/build_trees.py): деревья из OpenStreetMap, посадки в парках и скверах,
  // вдоль крупных улиц и во дворах частного сектора. Каждое дерево — экземпляр одной из двух моделей (лиственное, хвойное).
  var TREES = [];
  (function () {
    var T = window.GZ_TREES;
    if (!FX || !T || !T.xy) return;
    var x = 0, y = 0, xy = T.xy, k = T.k;
    for (var i = 0, n = 0; i < xy.length; i += 2, n++) {
      x += xy[i]; y += xy[i + 1];
      var kind = +k.charAt(n) || 0, h = ((((x * 2654435761) ^ (y * 40503)) >>> 0) % 1000) / 1000;
      TREES.push({ p: [T.origin[0] + x / T.scale, T.origin[1] + y / T.scale], con: kind & 1, sz: kind >> 1, j: h });
    }
  })();
  function treeMesh(conifer) {
    var m = new MeshBuilder(0), BARK = [0.36, 0.28, 0.22], LEAF = [1, 1, 1];
    m.frustum(0, 0, 0, conifer ? 1.6 : 2.2, 0.22, 0.16, 5, BARK);
    if (conifer) {
      m.frustum(0, 0, 1.4, 4.6, 1.7, 0.5, 7, LEAF);
      m.frustum(0, 0, 3.6, 7.2, 1.25, 0, 7, LEAF);
    } else {
      m.frustum(0, 0, 1.5, 2.0, 1.1, 2.1, 8, LEAF);      // низ кроны
      m.dome(0, 0, 2.0, 2.1, 3.4, LEAF, 8, 4);          // верх кроны
    }
    return m.mesh();
  }
  var TREE_MESH = TREES.length ? [treeMesh(0), treeMesh(1)] : null;
  var TREES_BY = [TREES.filter(function (t) { return !t.con; }), TREES.filter(function (t) { return t.con; })];
  var TREE_SIZE = [1.1, 1.5, 1.95];
  var TREE_MATERIAL = { ambient: 0.55, diffuse: 0.7, shininess: 4, specularColor: [10, 10, 10] };
  var treesShown = false;
  function treeLayers() {
    treesShown = cur.zoom >= (treesShown ? 13.2 : 13.6);
    if (!TREE_MESH || EDIT || !Q.trees || !treesShown) return [];
    return [0, 1].map(function (con) {
      return new D.SimpleMeshLayer({
        id: 'trees-' + con, data: TREES_BY[con], mesh: TREE_MESH[con],
        getPosition: function (d) { return [d.p[0], d.p[1], 0]; },
        getScale: function (d) { var s = TREE_SIZE[d.sz] * (0.85 + d.j * 0.3); return [s, s, s * (0.9 + d.j * 0.25)]; },
        getOrientation: function (d) { return [0, d.j * 360, 0]; },
        getColor: function (d) {
          return con ? [34 + d.j * 14, 66 + d.j * 18, 52 + d.j * 10] : [46 + d.j * 30, 84 + d.j * 30, 50 + d.j * 12];
        },
        material: TREE_MATERIAL
      });
    });
  }

  // Слой пересоздаётся, только когда меняется то, от чего он зависит (key); иначе deck.gl получает тот же объект и ничего не пересчитывает.
  // Слой, который хоть раз не попал в кадр (скрыт при отдалении, в режиме правки и т. п.), deck.gl уже уничтожил:
  // его нельзя отдавать повторно, поэтому такие записи из кэша удаляются в конце каждого кадра.
  var layerCache = {}, frameNo = 0;
  function keep(id, key, make) {
    var c = layerCache[id];
    if (c && c.key === key) { c.f = frameNo; return c.layer; }
    var l = make();
    layerCache[id] = { key: key, layer: l, f: frameNo };
    return l;
  }
  function sweepCache() {
    Object.keys(layerCache).forEach(function (id) { if (layerCache[id].f !== frameNo) delete layerCache[id]; });
  }
  var labelCache = { key: '', labeled: [] };
  var r400 = function (x) { return Math.round(x * 400) / 400; };
  var beamsCache = {};
  function beamsOf(yr) { return beamsCache[yr] || (beamsCache[yr] = LM.filter(function (l) { return l.year === yr; })); }

  function layers() {
    frameNo++;
    var z = cur.zoom, yr = yearOf(v), out = groundLayers.slice();
    var BLayer = useFacade ? FacadeLayer : D.SolidPolygonLayer, BSUF = useFacade ? '' : '-p';
    var frac = clamp(v - (yr - 1), 0, 1), pulse = Math.pow(Math.sin(Math.PI * frac), 0.7);   // 0 в начале и в конце года

    out.push(keep('streets', z >= 13.4, function () { return new D.TextLayer({
      id: 'streets', data: R.labels, visible: z >= 13.4,
      getPosition: function (d) { return [d[1], d[2]]; }, getText: function (d) { return d[0]; }, getAngle: function (d) { return d[3]; },
      billboard: false, sizeUnits: 'meters', getSize: function (d) { return d[4] === 0 ? 38 : 30; }, sizeMaxPixels: 20, sizeMinPixels: 0,
      getColor: [158, 172, 200, 215], fontFamily: FONT, fontWeight: 500, characterSet: 'auto',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 }, outlineWidth: 3, outlineColor: [10, 15, 26, 255], parameters: GROUND
    }); }));

    if (trafficOn()) {
      out.push(new D.TripsLayer({
        id: 'traffic', data: trips, getPath: function (d) { return d.p; }, getTimestamps: function (d) { return d.t; },
        getColor: function (d) { return d.d ? [255, 78, 56] : [255, 240, 205]; },
        opacity: 0.3 + 0.7 * (yr - Y0) / (Y1 - Y0),          // с годами движение на улицах оживает
        widthUnits: 'meters', getWidth: 3.2, widthMinPixels: 1.6, capRounded: true, jointRounded: true,
        trailLength: 2.4, fadeTrail: true, currentTime: (performance.now() / 1000) % TRIP_P, parameters: ADD
      }));
    }

    // здания и крыши — по одному слою на весь город; каждый кадр меняется только время (uTime),
    // а рост и вспышку по году постройки каждого дома считает видеокарта
    out.push(keep('buildings', [BSUF, selVer, groupVer].join(), function () { return new BLayer({
      id: 'buildings' + BSUF, facade: 1, data: ALL, getPolygon: function (d) { return d.p; }, extruded: true,
      getElevation: function (d) { return d.h; }, getFillColor: wallColor, getGrowth: wallGrowth,
      updateTriggers: { getFillColor: [selVer, groupVer], getGrowth: [selVer, groupVer] },
      material: MATERIAL, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 80]
    }); }).clone({ time: v }));
    var roofVis = z >= 12.6 && Q.roofs;
    if (useRoofs) out.push(keep('roofs', [selVer, groupVer, roofVis].join(), function () { return new GrowLayer({
      id: 'roofs', data: roofData(), _normalize: false, extruded: false, material: false, cull: 0.02, visible: roofVis
    }); }).clone({ time: v }));

    var tl = treeLayers();
    tl.forEach(function (l) { out.push(keep(l.id, 1, function () { return l; })); });
    if (FX && !EDIT) {
      var ub = uniBuilt();
      out.push(keep('uni-halo', uniCache.k, function () { return new D.PathLayer({
        id: 'uni-halo', data: ub, getPath: function (d) { return d.p[0]; }, getColor: [CHGU[0], CHGU[1], CHGU[2], 70],
        getWidth: 14, widthUnits: 'meters', widthMinPixels: 3, jointRounded: true, parameters: ADD
      }); }));
      out.push(keep('uni-edge', uniCache.k, function () { return new D.PathLayer({
        id: 'uni-edge', data: ub, getPath: function (d) { return d.p[0].map(function (q) { return [q[0], q[1], d.h + 0.4]; }); },
        getColor: [CHGU[0], CHGU[1], CHGU[2], 255], getWidth: 1.3, widthUnits: 'meters', widthMinPixels: 1.6,
        jointRounded: true, capRounded: true, parameters: { blend: true, blendFunc: [770, 1] }
      }); }));
    }

    MODELS.forEach(function (md) {
      var o = byId[md.bid][0], my = md.year || o.y, mg = my < Y0 ? 1 : r400(ease(v - (my - 1)));       // модель растёт вместе со своим зданием
      if (mg <= 0.001) return;
      if (md.ghost) {
        if (EDIT || !FX) return;
        out.push(keep(md.id, mg, function () { return new D.SimpleMeshLayer({
          id: md.id, data: [md], mesh: md.mesh, getPosition: function (d) { return [d.origin[0], d.origin[1], 0]; },
          getColor: [140, 190, 255], getScale: [1, 1, mg], opacity: 0.028, material: false,
          parameters: { blend: true, blendFunc: [770, 1], depthMask: false }, updateTriggers: { getScale: mg }
        }); }));
        return;
      }
      out.push(keep(md.id, mg, function () { return new D.SimpleMeshLayer({
        id: md.id, data: [md], mesh: md.mesh, getPosition: function (d) { return [d.origin[0], d.origin[1], 0]; },
        getColor: [255, 255, 255], _useMeshColors: true, getScale: [1, 1, mg], material: md.material,
        pickable: true, updateTriggers: { getScale: mg }
      }); }));
    });

    // подписи районов и посёлков
    out.push(keep('districts', z < 12.6, function () { return new D.TextLayer({
      id: 'districts', data: districts, visible: z < 12.6,
      getPosition: function (d) { return d.c; }, getText: function (d) { return d.name.toUpperCase() + '\nРАЙОН'; },
      getSize: 13, getColor: [200, 212, 235, 190], fontFamily: FONT, fontWeight: 600, characterSet: 'auto', lineHeight: 1.15,
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 }, outlineWidth: 3, outlineColor: [10, 15, 26, 255], parameters: GROUND
    }); }));
    out.push(keep('places', z >= 11.6 && z < 14.8, function () { return new D.TextLayer({
      id: 'places', data: BD.places, visible: z >= 11.6 && z < 14.8,
      getPosition: function (d) { return d.c; }, getText: function (d) { return d.name; },
      getSize: 12.5, getColor: [150, 164, 192, 200], fontFamily: FONT, fontWeight: 500, characterSet: 'auto',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 }, outlineWidth: 3, outlineColor: [10, 15, 26, 255], parameters: GROUND
    }); }));

    // знаковые объекты
    var shown = LM.filter(function (l) { return l.year <= yr; });
    var selI = selected ? selected.i : -1;
    // подписи: сначала выбранный объект и новинки года, затем главные, затем остальные; пересекающиеся скрываем
    var prio = function (l) { return l.i === selI ? 0 : l.year === yr ? 1 : MAJOR[l.short] ? 2 : 3; };
    var near = z >= 14.2, newCount = 0, shotLm = tour && SHOTS[tour.i] ? SHOTS[tour.i].short : null;
    var cand = shown.filter(function (l) {
      if (tour) return l.short === shotLm;                         // в кинопоказе — только объект текущего кадра
      if (prio(l) === 0) return true;
      if (calm) return MAJOR[l.short] || l.year === yr;
      if (near) return true;
      if (MAJOR[l.short]) return z >= 11.4;
      return l.year === yr && newCount++ < 3;                      // на общем виде из новинок года — не больше трёх
    }).sort(function (a, b) { return prio(a) - prio(b) || b.year - a.year; });
    var el = $('map'), W = el.clientWidth, Hh = el.clientHeight;
    var lkey = [cur.longitude.toFixed(6), cur.latitude.toFixed(6), z.toFixed(3), (cur.pitch || 0).toFixed(1), (cur.bearing || 0).toFixed(1),
      W, Hh, yr, selI, calm, tour ? tour.i : -1, $('card').hidden, cand.length].join();
    var labeled = labelCache.labeled;
    if (lkey !== labelCache.key) {
    var vp = new D.WebMercatorViewport({ width: W, height: Hh, longitude: cur.longitude,
      latitude: cur.latitude, zoom: cur.zoom, pitch: cur.pitch, bearing: cur.bearing });
    // занятые интерфейсом места: подписи туда не ставим
    var boxes = [];
    labeled = [];
    if (!calm) ['panel', 'tools', 'timeline', 'title', 'card', 'edit'].forEach(function (id) {
      var e = $(id);
      if (!e || e.hidden) return;
      var r = e.getBoundingClientRect();
      if (r.width) boxes.push([r.left - 6, r.top - 6, r.right + 6, r.bottom + 6]);
    });
    else boxes.push([0, 0, W * 0.42, Hh * 0.2]);                   // заголовок
    cand.forEach(function (l) {
      var p = vp.project([l.c[0], l.c[1], l.h + 3]), big = l.i === selI || l.year === yr || !!tour;
      var w = l.short.length * (big ? 9.6 : 8.2) + 24, hh = big ? 32 : 28;
      var bx = [p[0] - w / 2, p[1] - 22 - hh / 2, p[0] + w / 2, p[1] - 22 + hh / 2];
      if (bx[0] < 8 || bx[1] < 8 || bx[2] > W - 8 || bx[3] > Hh - 8) return;
      for (var i = 0; i < boxes.length; i++) {
        var q = boxes[i];
        if (bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1]) return;
      }
      boxes.push(bx); labeled.push(l);
    });
    labelCache = { key: lkey, labeled: labeled, ids: labeled.map(function (l) { return l.i; }).join() };
    }
    if (Q.glow && !EDIT) {
      // искры стройки над домами текущего года, ореолы и лучи над объектами, открытыми в этом году
      if (pulse > 0.02 && z >= 12 && byYear[yr]) {
        out.push(new D.IconLayer({
          id: 'glow-new', data: byYear[yr], iconAtlas: GLOW, iconMapping: GLOW_MAP, getIcon: function () { return 'g'; },
          getPosition: function (d) { return [d.c[0], d.c[1], d.h * frac + 2]; }, sizeUnits: 'meters',
          getSize: function (d) { return 34 + Math.sqrt(d.h) * 16; }, getColor: [255, 224, 160, 255], opacity: 0.55 * pulse,
          billboard: true, parameters: ADD, updateTriggers: { getPosition: Math.round(frac * 20) }
        }));
      }
      out.push(keep('flood', yr, function () { return new D.IconLayer({
        id: 'flood', data: shown.filter(function (l) { return FLOOD[l.short]; }), iconAtlas: GLOW, iconMapping: GLOW_MAP, getIcon: function () { return 'g'; },
        getPosition: function (d) { return [d.c[0], d.c[1], 4]; }, sizeUnits: 'meters', sizeMinPixels: 40,
        getSize: function (d) { return FLOOD[d.short]; }, getColor: [255, 232, 196, 70], billboard: false, parameters: ADD
      }); }));
      out.push(keep('glow-lm', yr, function () { return new D.IconLayer({
        id: 'glow-lm', data: shown, iconAtlas: GLOW, iconMapping: GLOW_MAP, getIcon: function () { return 'g'; },
        getPosition: function (d) { return [d.c[0], d.c[1], d.h + 6]; }, sizeUnits: 'meters', sizeMinPixels: 26,
        getSize: function (d) { return d.year === yr ? 250 : 160; },
        getColor: function (d) { var c = (CATS[d.cat] || CATS.other)[1]; return [c[0], c[1], c[2], d.year === yr ? 105 : 55]; },
        billboard: true, parameters: ADD, updateTriggers: { getSize: yr, getColor: yr }
      }); }));
      if (pulse > 0.02 && z <= 16.4) {            // вблизи луч заслонял бы само здание
        out.push(new D.ColumnLayer({
          id: 'beams', data: beamsOf(yr), getPosition: function (d) { return [d.c[0], d.c[1], 0]; },
          diskResolution: 10, radius: 3.2, extruded: true, getElevation: 620, elevationScale: 0.35 + 0.65 * frac,
          getFillColor: [255, 214, 150, 90], opacity: 0.8 * pulse, material: false,
          parameters: { blend: true, blendFunc: [770, 1], depthMask: false }
        }));
      }
    }
    var dotsAll = calm || tour;
    out.push(keep('lm-dots', [dotsAll ? labelCache.ids : shown.length, selI, yr].join(), function () { return new D.ScatterplotLayer({
      id: 'lm-dots', data: dotsAll ? labeled : shown, getPosition: function (d) { return [d.c[0], d.c[1], d.h + 3]; },
      radiusUnits: 'pixels', getRadius: function (d) { return d.i === selI ? 10 : d.year === yr ? 8 : 5.5; },
      getFillColor: function (d) { return (CATS[d.cat] || CATS.other)[1]; }, stroked: true, getLineColor: [10, 15, 26, 255],
      lineWidthUnits: 'pixels', getLineWidth: 2, billboard: true, pickable: true, parameters: GROUND,
      updateTriggers: { getRadius: [selI, yr] }
    }); }));
    out.push(keep('lm-labels', [labelCache.ids, selI, yr, !!tour].join(), function () { return new D.TextLayer({
      id: 'lm-labels', data: labeled, getPosition: function (d) { return [d.c[0], d.c[1], d.h + 3]; },
      getText: function (d) { return d.short; }, getPixelOffset: [0, -22], getSize: function (d) { return tour ? 17 : d.i === selI || d.year === yr ? 15 : 13; },
      getColor: function (d) { return (CATS[d.cat] || CATS.other)[1]; }, fontFamily: FONT, fontWeight: 600, characterSet: 'auto',
      background: true, getBackgroundColor: [10, 15, 26, 225], backgroundPadding: [7, 4],
      getBorderColor: [160, 180, 220, 70], getBorderWidth: 1, pickable: true, parameters: GROUND,
      updateTriggers: { getSize: [selI, yr, !!tour] }
    }); }));
    sweepCache();
    return out;
  }

  // ---------- карточки ----------
  function whenShort(o) {
    if (o.e && o.s !== 'k') return o.y ? String(o.y) : 'до 2000 года';
    if (o.s === 'k') return 'строится';
    if (o.s === 'm' || !o.y) return 'до 2000 года';
    if (o.s === 's') return o.y <= 1985 ? 'до 1985 года' : '≈ ' + o.y;
    if (o.s === 'n' || o.s === 'g') return '≈ ' + o.y;
    return String(o.y);
  }
  function showCard(html) { var c = $('card'); c.innerHTML = '<button class="x" aria-label="Закрыть">×</button>' + html; c.hidden = false; }
  function hideCard() { $('card').hidden = true; }
  $('card').addEventListener('click', function (e) { if (e.target.classList.contains('x')) { selected = null; hideCard(); dirty = true; renderLists(); } });

  function showBuilding(o) {
    var when, badge;
    if (o.e && o.s !== 'k') { when = o.y ? 'Год постройки: <b>' + o.y + '</b>' : 'Построено <b>до 2000 года</b>'; badge = 'уточнено сотрудниками музея'; }
    else if (o.s === 'k') { when = '<b>Строится</b>'; badge = 'данные OpenStreetMap'; }
    else if (o.s === 'c') { when = 'Год открытия: <b>' + o.y + '</b>'; badge = 'точная дата'; }
    else if (o.s === 'o') { when = 'Год постройки: <b>' + o.y + '</b>'; badge = 'данные OpenStreetMap'; }
    else if (o.s === 'r') { when = 'Введено в эксплуатацию: <b>' + o.y + '</b>'; badge = 'кадастр Росреестра'; }
    else if (o.s === 's') {
      when = o.y <= 1985 ? 'Территория застроена <b>не позднее 1985 года</b>' : 'Территория застроена <b>около ' + o.y + ' года</b>';
      badge = 'оценка по спутниковым снимкам';
    } else if (o.s === 'n') { when = 'Построено <b>около ' + o.y + ' года</b>'; badge = 'по дате появления на карте OpenStreetMap'; }
    else if (o.s === 'g') { when = 'Построено <b>около ' + o.y + ' года</b>'; badge = 'по соседним домам того же комплекса'; }
    else { when = 'Застройка <b>до 2000 года</b>'; badge = 'год постройки неизвестен'; }
    showCard('<div class="cat" style="color:' + (o.u ? css(CHGU) : '#93a0b8') + '">' + (o.u ? 'ЧГУ им. А. А. Кадырова' : (o.t || 'Здание')) + '</div>' +
      '<h2>' + (o.n || o.t || 'Здание') + '</h2><div class="when">' + when + '</div>' +
      (o.lv ? '<p>Этажей: ' + o.lv + '</p>' : '') + '<span class="badge">' + badge + '</span>');
  }

  function showLandmark(l) {
    var cat = CATS[l.cat] || CATS.other;
    var date = (l.month ? MONTHS[l.month - 1] + ' ' : '') + l.year;
    var when = l.kind === 'restoration' ? 'Восстановлено: <b>' + date + '</b>' : l.kind === 'reconstruction' ? 'Реконструкция: <b>' + date + '</b>' : 'Открытие: <b>' + date + '</b>';
    if (l.orig) when += ' · построено в ' + l.orig;
    showCard('<div class="cat" style="color:' + css(cat[1]) + '">' + cat[0] + '</div><h2>' + l.name + '</h2><div class="when">' + when + '</div><p>' + l.text + '</p>');
  }

  function select(l, fly) {
    selected = l;
    showLandmark(l);
    if (v < l.year) animateTo(l.year, 1400);
    if (fly) flyTo({ longitude: l.c[0], latitude: l.c[1], zoom: Math.max(cur.zoom, 15.4), pitch: is3d ? 56 : 0 }, 2400);
    renderLists();
    dirty = true;
  }

  // ---------- шкала времени ----------
  var bars = $('bars'), ticks = $('ticks');
  for (var y = Y0; y <= Y1; y++) {
    var b = document.createElement('div');
    b.className = 'bar';
    b.style.height = (8 + 92 * META.stats.perYear[y - Y0] / maxPerYear) + '%';
    b.style.transition = 'height .3s, opacity .2s';
    b.style.background = css(yearColor(y));
    bars.appendChild(b);
    var t = document.createElement('span');
    t.textContent = (y - Y0) % 2 === 0 ? y : '';
    ticks.appendChild(t);
  }
  $('fill').style.background = 'linear-gradient(90deg,' + STOPS.map(function (s) {
    return css(s[1]) + ' ' + ((s[0] - T0 - 0.5) / (T1 - T0) * 100).toFixed(1) + '%';
  }).join(',') + ')';
  document.querySelector('.sw-new').style.background = 'linear-gradient(90deg,' + STOPS.map(function (s) { return css(s[1]); }).join(',') + ')';

  var scrub = $('scrub'), dragging = false;
  function scrubTo(e) {
    var r = $('track').getBoundingClientRect();
    v = T0 + clamp((e.clientX - r.left) / r.width, 0, 1) * (T1 - T0);
    anim = null; dirty = true;
  }
  scrub.addEventListener('pointerdown', function (e) { dragging = true; scrub.setPointerCapture(e.pointerId); setPlaying(false); touch(); scrubTo(e); });
  scrub.addEventListener('pointermove', function (e) { if (dragging) { touch(); scrubTo(e); } });
  var endDrag = function () { dragging = false; };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);

  function setPlaying(p) {
    playing = p;
    $('ico-play').toggleAttribute('hidden', p); $('ico-pause').toggleAttribute('hidden', !p);
    $('play').setAttribute('aria-label', p ? 'Пауза' : 'Запустить');
    if (p) { anim = null; if (v >= T1 - 0.001) v = T0; }
  }
  $('play').addEventListener('click', function () { touch(); setPlaying(!playing); });

  function animateTo(target, ms) {
    setPlaying(false);
    anim = { from: v, to: clamp(target, T0, T1), t0: performance.now(), dur: ms || 900 };
  }

  // ---------- правая панель ----------
  function popAt(yr) {
    var p = META.population, best = p[0];
    for (var i = 0; i < p.length; i++) if (p[i][0] <= yr) best = p[i];
    return best;
  }
  function objButton(l, yr, showYear) {
    var cat = CATS[l.cat] || CATS.other;
    return '<button class="obj' + (l === selected ? ' sel' : '') + (l.year > yr ? ' future' : '') + '" data-i="' + l.i + '">' +
      '<i class="dot" style="background:' + css(cat[1]) + '"></i><span><span class="nm">' + l.name + '</span><span class="ds">' + cat[0] + '</span></span>' +
      (showYear ? '<span class="yr">' + l.year + '</span>' : '') + '</button>';
  }
  function renderLists() {
    var yr = yearOf(v);
    var evs = META.events.filter(function (e) { return e.year === yr; });
    var uni = META.chgu.filter(function (e) { return e.year === yr; });
    var objs = LM.filter(function (l) { return l.year === yr; });
    var n = META.stats.perYear[yr - Y0];
    var h = '<div class="bigyear">' + yr + '</div><div class="yearnote">За год на карте появилось ' + fmt(n) + ' ' + plural(n, 'здание', 'здания', 'зданий') + '</div>';
    h += '<h3>События</h3>';
    h += evs.map(function (e) { return '<div class="ev">' + e.text + '</div>'; }).join('');
    h += uni.map(function (e) { return '<div class="ev u"><span class="y">ЧГУ</span>' + e.text + '</div>'; }).join('');
    if (!evs.length && !uni.length) h += '<div class="empty">В хронике нет записей за этот год.</div>';
    if (objs.length) h += '<h3>Открыто в этом году</h3>' + objs.map(function (l) { return objButton(l, yr, false); }).join('');
    $('tab-year').innerHTML = h;

    $('tab-all').innerHTML = '<h3>Знаковые объекты, ' + Y0 + '–' + Y1 + '</h3>' + LM.map(function (l) { return objButton(l, yr, true); }).join('');

    var cg = LM.filter(function (l) { return l.cat === 'chgu'; });
    $('tab-chgu').innerHTML = '<h3>Чеченский государственный университет имени А. А. Кадырова</h3>' +
      cg.map(function (l) { return objButton(l, yr, true); }).join('') +
      '<h3>История университета</h3>' +
      META.chgu.map(function (e) { return '<div class="ev u"><span class="y">' + e.year + '</span>' + e.text + '</div>'; }).join('');
  }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
  }
  $('panel').addEventListener('click', function (e) {
    var btn = e.target.closest('.obj');
    if (btn) { touch(); select(LM[+btn.dataset.i], true); }
  });
  $('tabs').addEventListener('click', function (e) {
    var t = e.target.dataset.tab;
    if (!t) return;
    touch();
    Array.prototype.forEach.call($('tabs').children, function (b) { b.classList.toggle('on', b === e.target); });
    ['year', 'all', 'chgu'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
  });

  function renderUI() {
    var yr = yearOf(v), pct = (v - T0) / (T1 - T0) * 100;
    $('thumb').style.left = pct + '%';
    $('fill').style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0 round 99px)';
    $('fill').style.width = '100%';
    var done = clamp(v - (yr - 1), 0, 1);
    var built = (yr > Y0 ? cum[yr - Y0 - 1] : 0) + Math.round(META.stats.perYear[yr - Y0] * done);
    if (built !== lastBuilt) {
      lastBuilt = built;
      $('st-built').textContent = fmt(built);
      $('st-total').textContent = fmt(META.stats.base + built);
      $('stamp-n').textContent = built ? 'построено с ' + Y0 + ' года: ' + fmt(built) + ' ' + plural(built, 'здание', 'здания', 'зданий') : '';
    }
    if (yr === lastYear) return;
    lastYear = yr;
    $('year').textContent = yr;
    $('stamp-y').textContent = yr;
    Array.prototype.forEach.call(bars.children, function (b, i) { b.classList.toggle('on', Y0 + i <= yr); });
    Array.prototype.forEach.call(ticks.children, function (s, i) { s.classList.toggle('on', Y0 + i === yr); });
    var p = popAt(yr);
    $('st-pop').textContent = fmt(Math.round(p[1] / 1000)) + ' тыс.';
    $('st-pop-l').textContent = p[0] === yr ? 'жителей' : 'жителей (' + p[0] + ' г.)';
    renderLists();
  }

  // ---------- кнопки ----------
  $('btn-city').addEventListener('click', function () { touch(); flyTo(Object.assign({}, VIEWS.city, is3d ? {} : { pitch: 0 })); });
  $('btn-center').addEventListener('click', function () { touch(); flyTo(Object.assign({}, VIEWS.center, is3d ? {} : { pitch: 0 })); });
  $('btn-chgu').addEventListener('click', function () {
    touch();
    document.querySelector('#tabs [data-tab="chgu"]').click();
    var main = LM.filter(function (l) { return l.short === 'ЧГУ, главный корпус'; })[0];
    if (main) select(main, true);
  });
  $('btn-3d').addEventListener('click', function () {
    touch();
    is3d = !is3d;
    $('btn-3d').textContent = is3d ? '2D' : '3D';
    flyTo({ pitch: is3d ? 50 : 0, bearing: is3d ? cur.bearing : 0 }, 900);
  });
  $('btn-about').addEventListener('click', function () { touch(); $('about').hidden = false; });
  $('about-close').addEventListener('click', function () { $('about').hidden = true; });
  $('about').addEventListener('click', function (e) { if (e.target === $('about')) $('about').hidden = true; });
  var S = META.stats;
  $('about-stats').textContent = 'На карте ' + fmt(S.total) + ' зданий в границах городского округа: ' + fmt((S.bySource.c || 0) + (S.bySource.o || 0)) +
    ' с известным годом постройки, ' + fmt(S.bySource.s || 0) + ' — оценка по спутниковым снимкам, ' +
    fmt((S.bySource.n || 0) + (S.bySource.g || 0)) + ' — по дате появления на карте и по соседним домам комплекса, ' + fmt(S.bySource.k || 0) +
    ' строятся, ' + fmt(S.bySource.m || 0) + ' без данных. Данные собраны ' + META.built.split('-').reverse().join('.') + '.';

  window.addEventListener('keydown', function (e) {
    touch();
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {      // вход в режим правки и выход из него
      e.preventDefault();
      location.href = location.pathname + (EDIT ? '' : '?edit');
      return;
    }
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    else if (e.code === 'ArrowRight') animateTo(Math.floor(v + 1e-6) + 1, 700);
    else if (e.code === 'ArrowLeft') animateTo(Math.ceil(v - 1e-6) - 1, 700);
    else if (e.code === 'Escape') { $('about').hidden = true; selected = null; hideCard(); dirty = true; }
  });


  // ---------- режим правки ----------
  var SRC_RU = { c: 'точная дата', o: 'данные OpenStreetMap', s: 'оценка по спутнику', n: 'по появлению на карте',
    g: 'по соседним домам комплекса', m: 'нет данных', k: 'строится', e: 'правка музея' };
  function effectiveCorr() {
    var out = {}, id;
    for (id in fileCorr) if (has(fileCorr, id)) out[id] = fileCorr[id];
    for (id in localCorr) if (has(localCorr, id)) { if (localCorr[id]) out[id] = localCorr[id]; else delete out[id]; }
    return out;
  }
  function setSel(ids) {
    editSel.forEach(function (id) { (byId[id] || []).forEach(function (o) { o.sel = 0; }); });
    editSel = ids;
    editSel.forEach(function (id) { (byId[id] || []).forEach(function (o) { o.sel = 1; }); });
    selVer++; dirty = true;
    renderEdit();
  }
  function editClick(o, add) {
    if (!o) { if (!add) setSel([]); return; }
    if (!add) { setSel([o.id]); return; }
    setSel(editSel.indexOf(o.id) >= 0 ? editSel.filter(function (x) { return x !== o.id; }) : editSel.concat([o.id]));
  }
  function refreshAfterEdit(keys) {
    regroup(keys);
    recomputeStats();
    Array.prototype.forEach.call(bars.children, function (b, i) { b.style.height = (8 + 92 * META.stats.perYear[i] / maxPerYear) + '%'; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(localCorr)); } catch (err) { editMsg('Не удалось запомнить правки в браузере — сохраните файл.'); }
    lastYear = -1; lastBuilt = -1; selVer++; dirty = true;
    renderEdit();
  }
  // changes: { id: правка | null | undefined }; null — вернуть исходные данные, undefined — убрать локальную правку
  function commit(changes, noUndo) {
    var prev = {}, keys = {};
    Object.keys(changes).forEach(function (id) {
      prev[id] = has(localCorr, id) ? localCorr[id] : undefined;
      if (changes[id] === undefined || (changes[id] === null && !fileCorr[id])) delete localCorr[id];
      else localCorr[id] = changes[id];
      var k = applyCorr(id);
      for (var x in k) keys[x] = 1;
    });
    if (!noUndo) undoStack.push(prev);
    refreshAfterEdit(keys);
  }
  function editMsg(t) { var m = $('e-msg'); if (m) { m.textContent = t; m.hidden = !t; } }
  function applyEdit(kind) {
    if (!editSel.length) return;
    var year = null, name = null, single = editSel.length === 1;
    if (kind === 'year') {
      var raw = $('e-year').value.trim();
      if (raw !== '') {
        year = parseInt(raw, 10);
        if (!(year >= 1800 && year <= Y1) || String(year) !== raw) { editMsg('Введите год от 1800 до ' + Y1 + '.'); return; }
      }
      if (single) name = $('e-name').value.trim();
      if (year === null && (!single || name === byId[editSel[0]][0].n)) { editMsg('Введите год постройки.'); return; }
    }
    var ch = {};
    editSel.forEach(function (id) {
      var old = corrOf(id) || {}, c = {};
      if (kind === 'old') c.y = 0;
      else if (kind === 'constr') { c.y = Y1; c.k = 1; }
      else if (year !== null) c.y = year;
      else { if (old.y != null) c.y = old.y; if (old.k) c.k = 1; }
      var n0 = byId[id][0].n0;
      if (single && name !== null) { if (name !== n0) c.n = name; }
      else if (old.n != null) c.n = old.n;
      ch[id] = c;
    });
    commit(ch);
    editMsg('Исправлено зданий: ' + editSel.length + '. Не забудьте сохранить файл правок.');
  }
  function renderEdit() {
    if (!EDIT || !$('edit')) return;
    var n = editSel.length;
    $('e-count').textContent = 'правок: ' + Object.keys(effectiveCorr()).length;
    $('e-form').hidden = !n;
    $('e-hint').hidden = !!n;
    $('e-undo').disabled = !undoStack.length;
    if (!n) return;
    var objs = editSel.map(function (id) { return byId[id][0]; }), o = objs[0], seen = {}, years = [];
    objs.forEach(function (x) { var w = whenShort(x); if (!seen[w]) { seen[w] = 1; years.push(w); } });
    $('e-info').innerHTML = (n === 1 ? '<b>' + (o.n || o.t || 'Здание') + '</b>' : '<b>Выбрано зданий: ' + n + '</b>') +
      '<br>Сейчас: ' + years.slice(0, 6).join(', ') + (years.length > 6 ? '…' : '') +
      (n === 1 ? ' <span class="src">(' + (o.e ? SRC_RU.e : SRC_RU[o.s]) + ')</span>' : '');
    $('e-year').value = years.length === 1 && o.y >= 1800 && o.s !== 'k' && (o.e || o.s === 'c' || o.s === 'o') ? o.y : '';
    $('e-name-row').hidden = n !== 1;
    $('e-name').value = n === 1 ? o.n : '';
    $('e-similar').hidden = !objs.some(function (x) { return x.g >= 0; });
    $('e-revert').disabled = !objs.some(function (x) { return x.e || x.n !== x.n0; });
  }
  function saveCorrections() {
    var corr = effectiveCorr(), ids = Object.keys(corr).sort();
    var text = '// Правки годов постройки, сделанные в режиме правки. Файл должен лежать в папке app/data.\n' +
      '// Ключ — идентификатор здания в OpenStreetMap; y — год (0 — до 2000 года), k: 1 — строится, n — название.\n' +
      '// Сохранено ' + new Date().toLocaleString('ru-RU') + ', правок: ' + ids.length + '.\n' +
      'window.GZ_CORRECTIONS = {\n' + ids.map(function (id) { return '  ' + JSON.stringify(id) + ': ' + JSON.stringify(corr[id]); }).join(',\n') + '\n};\n';
    var done = function () { editMsg('Файл сохранён. Он должен лежать в папке app/data под именем corrections.js.'); };
    var download = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      a.download = 'corrections.js';
      document.body.appendChild(a); a.click(); a.remove();
      editMsg('Файл corrections.js скачан. Переложите его в папку app/data вместо прежнего.');
    };
    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({ suggestedName: 'corrections.js', types: [{ description: 'Файл правок', accept: { 'text/javascript': ['.js'] } }] })
        .then(function (h) { return h.createWritable(); })
        .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
        .then(done, function (err) { if (!err || err.name !== 'AbortError') download(); });
    } else download();
  }
  function loadCorrections(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var t = String(rd.result), a = t.indexOf('{', Math.max(0, t.indexOf('GZ_CORRECTIONS'))), b = t.lastIndexOf('}');
        var obj = JSON.parse(t.slice(a, b + 1)), ch = {}, n = 0;
        Object.keys(obj).forEach(function (id) { if (byId[id] && obj[id] && typeof obj[id] === 'object') { ch[id] = obj[id]; n++; } });
        commit(ch);
        editMsg('Загружено правок: ' + n + '.');
      } catch (err) { editMsg('Не удалось прочитать файл правок.'); }
    };
    rd.readAsText(file);
  }
  function initEdit() {
    document.body.classList.add('editing');
    document.querySelector('#title .kicker').textContent = 'Режим правки · выход: Ctrl+Shift+E';
    var el = document.createElement('div');
    el.id = 'edit';
    el.innerHTML =
      '<div class="eh"><b>Правка годов постройки</b><span id="e-count"></span></div>' +
      '<div id="e-hint">Щёлкните здание на карте. Shift + щелчок добавляет здание к выбору. Карту можно двигать как обычно.</div>' +
      '<div id="e-form" hidden>' +
        '<div id="e-info"></div>' +
        '<label>Год постройки<input id="e-year" type="text" inputmode="numeric" maxlength="4" placeholder="например, 2014"></label>' +
        '<label id="e-name-row">Название (необязательно)<input id="e-name" type="text" maxlength="120"></label>' +
        '<div class="row"><button id="e-apply" class="pri">Применить</button><button id="e-old">До 2000 года</button><button id="e-constr">Строится</button></div>' +
        '<div class="row"><button id="e-similar">+ одинаковые дома рядом</button><button id="e-revert">Вернуть как было</button></div>' +
      '</div>' +
      '<div id="e-msg" hidden></div>' +
      '<div class="row foot"><button id="e-save" class="pri">Сохранить файл правок</button><button id="e-load">Загрузить</button><button id="e-undo">Отменить</button></div>' +
      '<input id="e-file" type="file" accept=".js,.json" hidden>' +
      '<div class="note">Правки сразу видны на этом компьютере. Чтобы они попали в экспозицию, сохраните файл corrections.js в папку app/data.</div>';
    document.body.appendChild(el);
    $('e-apply').addEventListener('click', function () { applyEdit('year'); });
    $('e-old').addEventListener('click', function () { applyEdit('old'); });
    $('e-constr').addEventListener('click', function () { applyEdit('constr'); });
    $('e-year').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyEdit('year'); });
    $('e-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyEdit('year'); });
    $('e-similar').addEventListener('click', function () {
      var groups = {}, ids = editSel.slice(), seen = {};
      editSel.forEach(function (id) { seen[id] = 1; var g = byId[id][0].g; if (g >= 0) groups[g] = 1; });
      ALL.forEach(function (o) { if (groups[o.g] && !seen[o.id]) { seen[o.id] = 1; ids.push(o.id); } });
      setSel(ids);
      editMsg('Выбраны дома того же комплекса: ' + ids.length + '.');
    });
    $('e-revert').addEventListener('click', function () {
      var ch = {};
      editSel.forEach(function (id) { ch[id] = null; });
      commit(ch);
      editMsg('Возвращены исходные данные.');
    });
    $('e-undo').addEventListener('click', function () {
      var prev = undoStack.pop();
      if (prev) { commit(prev, true); editMsg('Последняя правка отменена.'); }
    });
    $('e-save').addEventListener('click', saveCorrections);
    $('e-load').addEventListener('click', function () { $('e-file').click(); });
    $('e-file').addEventListener('change', function () { if (this.files[0]) loadCorrections(this.files[0]); this.value = ''; });
    v = T1;
    renderEdit();
  }
  if (EDIT) initEdit();


  // ---------- кинопоказ: камера сама ведёт по главным стройкам, время замедляется на каждой ----------
  var TOUR_FAST = 1.0, TOUR_SLOW = 6.5;       // секунд на год: между остановками и на остановке
  var tour = null, tourStopped = 0;
  var SHOTS = (function () {
    var by = {};
    LM.forEach(function (l) { by[l.short] = l; });
    var first = function (t) { var m = /^.*?[.!?](?=\s|$)/.exec(t); return m ? m[0] : t; };
    var lm = function (short, title, zoom, bearing) {
      var l = by[short];
      return l && { y: l.year, short: short, title: title || l.name, text: first(l.text),
        view: { longitude: l.c[0], latitude: l.c[1], zoom: zoom, pitch: 62, bearing: bearing } };
    };
    return [
      { y: Y0, title: 'Грозный, ' + Y0 + ' год', text: 'Серым показана застройка, которая существовала к началу века. Дальше — всё, что построено с тех пор.',
        view: Object.assign({}, VIEWS.start, { zoom: 13.1 }) },
      lm('Пр. Победы: восстановление', 'Проспект Победы', 16.2, -28),
      lm('Сердце Чечни', 'Мечеть «Сердце Чечни»', 18.2, 24),
      lm('Грозный-Сити', 'Комплекс «Грозный-Сити»', 16.9, -40),
      lm('ЧГУ, главный корпус', 'Главный корпус ЧГУ', 17.5, 30),
      lm('Национальная библиотека', 'Национальная библиотека', 17.4, -20),
      lm('Колизей', 'Спорткомплекс «Колизей»', 17.2, 35),
      lm('Дворец волейбола', 'Дворец волейбола и «Ахмат Арена»', 16.3, -30),
      lm('Грозный Молл', 'ТРЦ «Грозный Молл»', 16.8, 20),
      lm('ЧГУ, новый корпус', 'Новый учебный корпус ЧГУ', 17.3, -25),
      lm('Ахмат Тауэр', 'Строится «Ахмат Тауэр»', 15.6, -20),
      { y: 2025, title: 'Район имени В. В. Путина', text: 'Первая очередь нового района: 30 жилых домов вдоль нового проспекта.',
        view: { longitude: 45.6695, latitude: 43.3297, zoom: 15.7, pitch: 60, bearing: -38 } },
      { y: Y1, title: 'Грозный сегодня', text: '',
        view: Object.assign({}, VIEWS.start, { zoom: 12.9, pitch: 55, bearing: 10 }) }
    ].filter(Boolean).sort(function (a, b) { return a.y - b.y; });
  })();
  function showCaption(sh) {
    var el = $('caption');
    $('cap-y').textContent = sh.y;
    $('cap-t').textContent = sh.title;
    $('cap-x').textContent = sh.y === Y1 && !sh.text ? 'С ' + Y0 + ' года на карте появилось ' + fmt(cum[cum.length - 1]) + ' зданий.' : sh.text;
    el.classList.remove('on');
    void el.offsetWidth;                    // перезапуск анимации появления
    el.classList.add('on');
  }
  function orbit(deg, ms) {
    cur = Object.assign({}, cur, LIMITS, { bearing: cur.bearing + deg, transitionDuration: ms,
      transitionInterpolator: new D.LinearInterpolator(['bearing']) });
    deckgl.setProps({ initialViewState: cur });
  }
  function startTour(isAttract) {
    if (EDIT) return;
    setPlaying(false);
    anim = null; selected = null; hideCard(); $('about').hidden = true;
    attract = !!isAttract;
    document.body.classList.add('cinema');
    calm = true; document.body.classList.add('calm');
    v = T0;
    tour = { i: 0, phase: 'fly', t0: performance.now() };
    flyTo(SHOTS[0].view, 3800);
    showCaption(SHOTS[0]);
    dirty = true;
  }
  function stopTour() {
    if (!tour) return;
    tour = null; attract = false; tourStopped = performance.now();
    document.body.classList.remove('cinema');
    $('caption').classList.remove('on');
    cur = Object.assign({}, cur, LIMITS, { transitionDuration: 0 });       // остановить полёт камеры
    deckgl.setProps({ initialViewState: cur });
    dirty = true;
  }
  function tourStep(now, dt) {
    if (!tour) return;
    var sh = SHOTS[tour.i];
    if (tour.phase === 'fly') {
      if (now - tour.t0 > 4000) { tour.phase = 'rise'; orbit(tour.i % 2 ? -22 : 22, 17000); }
    } else if (tour.phase === 'rise') {
      v += dt / 1000 / TOUR_SLOW;
      if (v >= sh.y) { v = sh.y; tour.i++; tour.phase = tour.i < SHOTS.length ? 'run' : 'end'; tour.t0 = now; }
    } else if (tour.phase === 'run') {
      v += dt / 1000 / TOUR_FAST;
      if (v >= sh.y - 1) { v = sh.y - 1; tour.phase = 'fly'; tour.t0 = now; flyTo(sh.view, 3800); showCaption(sh); }
    } else if (now - tour.t0 > 12000) {
      if (attract) startTour(true); else stopTour();
    }
    dirty = true;
  }
  $('btn-tour').addEventListener('click', function () {
    if (performance.now() - tourStopped < 500) return;      // этим же нажатием показ только что остановили
    startTour(false);
  });

  // ---------- режим показа и демонстрационный режим ----------
  // Через 20 секунд без касаний панели уходят и камера медленно облетает город; через 3 минуты запускается кинопоказ.
  function setCalm(c) {
    if (EDIT) c = false;
    if (c === calm) return;
    calm = c;
    document.body.classList.toggle('calm', c);
    if (!tour) {
      if (c) orbit(-90, 240000);
      else { cur = Object.assign({}, cur, LIMITS, { transitionDuration: 0 }); deckgl.setProps({ initialViewState: cur }); }
    }
    dirty = true;
  }
  function touch() {
    lastInput = performance.now();
    if (tour) stopTour();
    attract = false;
    setCalm(false);
  }
  ['pointerdown', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, touch, { passive: true }); });

  var lastHaze = -1;
  function updateHaze() {
    var p = Math.round(cur.pitch || 0);
    if (p === lastHaze) return;
    lastHaze = p;
    var k = clamp((p - 20) / 45, 0, 1);
    $('haze').style.background = k ? 'linear-gradient(180deg,' +
      'rgba(32,38,64,' + (0.94 * k).toFixed(3) + ') 0%,' +
      'rgba(58,52,70,' + (0.6 * k).toFixed(3) + ') ' + (8 + 10 * k).toFixed(1) + '%,' +
      'rgba(40,40,60,' + (0.22 * k).toFixed(3) + ') ' + (20 + 16 * k).toFixed(1) + '%,' +
      'rgba(20,24,40,0) ' + (34 + 22 * k).toFixed(1) + '%)' : 'none';
  }

  // ---------- автоматическое качество ----------
  // Каждые 4 секунды считаем средний кадр. Меньше 24 кадров в секунду два окна подряд — уровень снижается на ступень.
  // Если потом карта стабильно идёт плавно (больше 50 кадров в секунду три окна подряд), уровень возвращается обратно;
  // если после возврата снова тормозит — следующая попытка будет вдвое позже. Так короткая заминка (например, при отдалении
  // на весь город) не отключает деревья и огни машин навсегда.
  // Кадры длиннее четверти секунды не учитываются: так бывает, когда окно свёрнуто или браузер притормаживает фоновую вкладку.
  var lastTraffic = 0, qWin = { t0: 0, n: 0, sum: 0, slow: 0 }, qLast = 0, qSlow = 0, qFast = 0, qBack = 20000, qRaised = false;
  (function () {
    var m = /[?&]quality=(\d)/.exec(location.search);
    if (m) { setQuality(clamp(+m[1], 0, 3)); Q.fixed = true; }
  })();
  function autoQuality(now, dt) {
    if (Q.fixed || document.hidden || now < 6000) return;
    if (!qWin.t0) qWin.t0 = now;
    if (dt > 250) qWin.slow++; else { qWin.n++; qWin.sum += dt; }
    if (now - qWin.t0 < 4000) return;
    var fps = qWin.n ? 1000 / (qWin.sum / qWin.n) : 60, throttled = qWin.slow > qWin.n;
    qWin = { t0: now, n: 0, sum: 0, slow: 0 };
    if (throttled) return;
    if (fps < 24) { qSlow++; qFast = 0; } else if (fps > 50) { qFast++; qSlow = 0; } else { qSlow = 0; qFast = 0; }
    if (qSlow >= 2 && Q.level < 3 && now - qLast > 6000) {
      if (qRaised) { qBack *= 2; qRaised = false; }
      qLast = now; qSlow = 0;
      setQuality(Q.level + 1);
      if (window.console) console.info('Карта: мало кадров (' + fps.toFixed(0) + ' в секунду), уровень качества ' + Q.level);
    } else if (qFast >= 3 && Q.level > 0 && now - qLast > qBack) {
      qLast = now; qFast = 0; qRaised = true;
      setQuality(Q.level - 1);
      if (window.console) console.info('Карта: кадров достаточно (' + fps.toFixed(0) + ' в секунду), уровень качества ' + Q.level);
    }
  }

  // ---------- главный цикл ----------
  var prev = performance.now();
  function frame(now) {
    var dt = Math.min(100, now - prev);
    prev = now;
    if (playing && now >= pauseUntil) {
      v += dt / 1000 / SEC_PER_YEAR;
      if (v >= T1) {
        v = T1;
        setPlaying(false);
      }
      dirty = true;
    }
    if (anim) {
      var k = clamp((now - anim.t0) / anim.dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      v = anim.from + (anim.to - anim.from) * e;
      if (k >= 1) anim = null;
      dirty = true;
    }
    tourStep(now, dt);
    if (trafficOn() && now - lastTraffic > 33) { lastTraffic = now; dirty = true; }     // огни машин: 30 раз в секунду
    autoQuality(now, dt);
    if (!EDIT && !tour && !playing && now - lastInput > IDLE_MS) startTour(true);
    if (!EDIT && !calm && !tour && now - lastInput > CALM_MS && $('about').hidden) setCalm(true);
    if (dirty) {
      dirty = false;
      updateHaze();
      deckgl.setProps({ layers: layers() });
      renderUI();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // для отладки и настройки на месте
  window.GZ = { quality: function (lv) { if (lv != null) { setQuality(lv); Q.fixed = true; } return Q; }, tour: { start: startTour, stop: stopTour, step: tourStep, state: function () { return tour; }, shots: SHOTS }, fx: function () { return { facade: useFacade, trips: trips.length, models: MODELS.map(function (m) { return m.id + ':' + m.mesh.attributes.positions.value.length / 9; }) }; }, edit: { select: function (ids) { setSel(ids); }, corrections: effectiveCorr, byId: byId }, setYear: function (y) { v = clamp(y, T0, T1); dirty = true; }, flyTo: flyTo, deck: deckgl, state: function () { return { v: v, view: cur }; } };
})();
