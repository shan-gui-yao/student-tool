/*
 * 极简 PPTX 生成器（无依赖）
 * 用一份 python-pptx 生成的模板当骨架，只替换幻灯片内容，
 * 再用 stored（不压缩）方式重新打包成 zip。
 */
const fs = require('fs');
const path = require('path');

const TPL = JSON.parse(fs.readFileSync(path.join(__dirname, 'parts.json'), 'utf8'));

/* ---------- 工具 ---------- */
const enc = new TextEncoder();

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
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

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
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

  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const all = locals.concat(central, [eocd]);
  const total = all.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  all.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}

/* ---------- 幻灯片 ---------- */
const SLIDE_TPL = TPL.find((p) => p.name === 'ppt/slides/slide1.xml').text;
const SLIDE_RELS = TPL.find((p) => p.name === 'ppt/slides/_rels/slide1.xml.rels').text;

function slideXml(title, pts) {
  const marker1 = '<a:p><a:r><a:t>A</a:t></a:r></a:p>';
  const marker2 = '<a:p><a:r><a:t>B</a:t></a:r></a:p>';
  let head = SLIDE_TPL.split(marker1)[0];
  const tail = SLIDE_TPL.split(marker2)[1];
  head = head.replace('<a:t>T</a:t>', '<a:t>' + xmlEsc(title) + '</a:t>');
  const paras = pts.map((p) => '<a:p><a:r><a:t>' + xmlEsc(p) + '</a:t></a:r></a:p>').join('');
  return head + paras + tail;
}

function buildPptx(deckTitle, slides) {
  const files = [];
  const slideNames = slides.map((_, i) => 'ppt/slides/slide' + (i + 1) + '.xml');

  TPL.forEach((part) => {
    if (part.name.startsWith('ppt/slides/')) return; // 幻灯片全部重新生成

    if (part.name === 'ppt/presentation.xml') {
      const ids = slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rIdS' + (i + 1) + '"/>').join('');
      const xml = part.text.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst>' + ids + '</p:sldIdLst>');
      files.push({ name: part.name, data: enc.encode(xml) });
      return;
    }

    if (part.name === 'ppt/_rels/presentation.xml.rels') {
      let xml = part.text.replace(/<Relationship[^>]*relationships\/slide"[^>]*\/>/g, '');
      const add = slides.map((_, i) =>
        '<Relationship Id="rIdS' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>'
      ).join('');
      xml = xml.replace('</Relationships>', add + '</Relationships>');
      files.push({ name: part.name, data: enc.encode(xml) });
      return;
    }

    if (part.name === '[Content_Types].xml') {
      let xml = part.text.replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '');
      const add = slides.map((_, i) =>
        '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      ).join('');
      xml = xml.replace('</Types>', add + '</Types>');
      files.push({ name: part.name, data: enc.encode(xml) });
      return;
    }

    if (part.b64 !== undefined) {
      files.push({ name: part.name, data: new Uint8Array(Buffer.from(part.b64, 'base64')) });
    } else {
      files.push({ name: part.name, data: enc.encode(part.text) });
    }
  });

  slides.forEach((s, i) => {
    files.push({ name: slideNames[i], data: enc.encode(slideXml(s.title, s.pts)) });
    files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: enc.encode(SLIDE_RELS) });
  });

  return zip(files);
}

module.exports = { buildPptx };

/* ---------- 本地测试 ---------- */
if (require.main === module) {
  const demo = [
    { title: '邻接矩阵', pts: ['表示一张图最常用的两种方式是邻接矩阵和邻接表'] },
    { title: '邻接表', pts: ['邻接表用链表或者数组存每个点的邻居', '适合稀疏图'] },
    { title: '时间复杂度', pts: ['这两种遍历的时间复杂度都是 O(V+E)', '这个要记住'] },
    { title: '单源最短路', pts: ['单源最短路最经典的是 Dijkstra', '它要求边权非负'] }
  ];
  const buf = buildPptx('数据结构 第 8 讲', demo);
  fs.writeFileSync(path.join(__dirname, 'out.pptx'), Buffer.from(buf));
  console.log('written', buf.length, 'bytes');
}
