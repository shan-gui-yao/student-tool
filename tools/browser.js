/* PPTX 生成器（浏览器版）—— 依赖 window.__PPTX_TPL 里的模板部件 */
(function () {
  var enc = new TextEncoder();
  var TPL = window.__PPTX_TPL;

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(buf) {
    var c = -1;
    for (var i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  function zip(files) {
    var locals = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      locals.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    var all = locals.concat(central, [eocd]);
    var total = all.reduce(function (a, b) { return a + b.length; }, 0);
    var out = new Uint8Array(total);
    var p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  var SLIDE_TPL = TPL.find(function (p) { return p.name === 'ppt/slides/slide1.xml'; }).text;
  var SLIDE_RELS = TPL.find(function (p) { return p.name === 'ppt/slides/_rels/slide1.xml.rels'; }).text;

  function slideXml(title, pts) {
    var head = SLIDE_TPL.split('<a:p><a:r><a:t>A</a:t></a:r></a:p>')[0];
    var tail = SLIDE_TPL.split('<a:p><a:r><a:t>B</a:t></a:r></a:p>')[1];
    head = head.replace('<a:t>T</a:t>', '<a:t>' + xmlEsc(title) + '</a:t>');
    var paras = pts.map(function (p) {
      return '<a:p><a:r><a:t>' + xmlEsc(p) + '</a:t></a:r></a:p>';
    }).join('');
    return head + paras + tail;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  window.buildPptx = function (title, slides) {
    var files = [];

    TPL.forEach(function (part) {
      if (part.name.indexOf('ppt/slides/') === 0) return;

      if (part.name === 'ppt/presentation.xml') {
        var ids = slides.map(function (_, i) {
          return '<p:sldId id="' + (256 + i) + '" r:id="rIdS' + (i + 1) + '"/>';
        }).join('');
        var xml = part.text.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst>' + ids + '</p:sldIdLst>');
        files.push({ name: part.name, data: enc.encode(xml) });
        return;
      }

      if (part.name === 'ppt/_rels/presentation.xml.rels') {
        var r = part.text.replace(/<Relationship[^>]*relationships\/slide"[^>]*\/>/g, '');
        var add = slides.map(function (_, i) {
          return '<Relationship Id="rIdS' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>';
        }).join('');
        files.push({ name: part.name, data: enc.encode(r.replace('</Relationships>', add + '</Relationships>')) });
        return;
      }

      if (part.name === '[Content_Types].xml') {
        var ct = part.text.replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '');
        var ov = slides.map(function (_, i) {
          return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
        }).join('');
        files.push({ name: part.name, data: enc.encode(ct.replace('</Types>', ov + '</Types>')) });
        return;
      }

      if (part.b64 !== undefined) {
        files.push({ name: part.name, data: b64ToBytes(part.b64) });
      } else {
        files.push({ name: part.name, data: enc.encode(part.text) });
      }
    });

    slides.forEach(function (s, i) {
      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: enc.encode(slideXml(s.title, s.pts)) });
      files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: enc.encode(SLIDE_RELS) });
    });

    var buf = zip(files);
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  };
})();
