// Vault-side DataviewJS view. Reads ordinary Sparkle Markdown; never writes notes.
const mode = input?.mode || 'all';
const root = dv.container.createDiv({ cls: 'sparkle-demo-view' });
root.dataset.mode = mode;
const source = '"日记" or "主题"';
const pages = dv.pages(source).array();
const headings = new Set(['Ideas', '灵感', app.plugins.getPlugin('sparkle')?.settings?.heading].filter(Boolean));
const records = [];

try {
  await Promise.all(pages.map(async page => {
    const raw = await dv.io.load(page.file.path);
    if (typeof raw !== 'string') return;
    const accepted = new Set([...headings, page.sparkle_heading].filter(Boolean));
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    let active = false;
    let current = null;
    const flush = () => {
      if (!current) return;
      current.body = current.body.join('\n').replace(/\s+\^[\w-]+\s*$/u, '').trim();
      current.tags = [...new Set((current.header + '\n' + current.body).match(/#[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*/gu) || [])];
      current.image = /!\[\[|!\[[^\]]*\]\(/u.test(current.body);
      const geo = /\[([^\]]+)\]\(geo:([+-]?[\d.]+),\s*([+-]?[\d.]+)\)/u.exec(current.header + '\n' + current.body);
      current.geo = geo ? { name: geo[1].replace(/^📍\s*/u, ''), latitude: Number(geo[2]), longitude: Number(geo[3]) } : null;
      records.push(current);
      current = null;
    };
    for (const [index, line] of lines.entries()) {
      const heading = /^(#{1,2})\s+(.+?)\s*#*\s*$/u.exec(line);
      if (heading) { flush(); active = heading[1] === '##' && accepted.has(heading[2]); continue; }
      if (!active) continue;
      const entry = /^-\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{2}:\d{2}:\d{2})(.*)$/u.exec(line);
      if (entry) {
        flush();
        const day = entry[1] || /^\d{4}-\d{2}-\d{2}$/u.exec(page.file.name)?.[0];
        if (!day) continue;
        current = { date: day, time: entry[2], header: entry[3].trim(), body: [], path: page.file.path, name: page.file.name, kind: page.file.path.startsWith('日记/') ? 'daily' : 'file', line: index, id: null };
      } else if (current && (/^ {4}/u.test(line) || !line.trim())) current.body.push(line.replace(/^ {4}/u, ''));
      else if (current) flush();
      if (current) current.id ||= /\^([\w-]+)\s*$/u.exec(line)?.[1] || null;
    }
    flush();
  }));
} catch (error) {
  root.createEl('p', { text: '读取记录失败：' + error.message });
  return;
}
records.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || a.path.localeCompare(b.path));
root.dataset.totalRecords = String(records.length);
if (!records.length) { root.createEl('p', { text: '暂未找到记录。请确认 Dataview 已索引演示日记和主题笔记。' }); return; }

const aggregate = (items, key) => {
  const counts = new Map();
  for (const item of items) for (const value of [].concat(key(item))) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const totals = [
  ['记录总数', records.length], ['日记记录', records.filter(r => r.kind === 'daily').length],
  ['主题记录', records.filter(r => r.kind === 'file').length], ['带图片', records.filter(r => r.image).length],
  ['带位置', records.filter(r => r.geo).length], ['覆盖天数', new Set(records.map(r => r.date)).size],
];
const metrics = root.createDiv({ cls: 'sparkle-demo-metrics' });
for (const [label, count] of totals) {
  const card = metrics.createDiv({ cls: 'sparkle-demo-metric' });
  card.createSpan({ text: label }); card.createEl('strong', { text: String(count) });
}

if (mode === 'summary') return;

if (mode === 'stats') {
  const daily = aggregate(records, r => r.date).sort((a,b) => a[0].localeCompare(b[0]));
  const tags = aggregate(records, r => r.tags).slice(0, 12);
  const heat = root.createDiv({ cls: 'sparkle-demo-heat' });
  heat.hidden = daily.length < 7;
  for (const [day, count] of daily) {
    const cell = heat.createEl('a', { cls: 'sparkle-demo-heat-cell internal-link', attr: { href: '日记/' + day, 'data-href': '日记/' + day, title: `${day} · ${count} 条` } });
    cell.dataset.level = String(Math.min(4, Math.ceil(count / 3)));
    cell.setAttribute('aria-label', `${day}：${count} 条记录`);
  }
  if(daily.length >= 7) root.createEl('p', { text: '每日记录热度 · 点击格子打开当天日记。统计包含日记与主题笔记中的全部记录。', cls: 'sparkle-demo-caption' });
  const renderChart = root.ownerDocument.defaultView.renderChart;
  if (typeof renderChart === 'function') {
    const color = getComputedStyle(root).getPropertyValue('--text-normal').trim();
    const charts = root.createDiv({ cls: 'sparkle-demo-charts' });
    const common = { responsive: true, maintainAspectRatio: false, animation: false };
    const trend = {
      type: 'line',
      data: { labels: daily.map(x => x[0].slice(5)), datasets: [{ label: '记录数', data: daily.map(x => x[1]), borderColor: '#d09a59', backgroundColor: 'rgba(208,154,89,.13)', fill: true, tension: .25 }] },
      options: { ...common, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color } }, x: { ticks: { color, maxTicksLimit: 12 } } } }
    };
    const distribution = {
      type: 'bar',
      data: { labels: tags.map(x => x[0]), datasets: [{ label: '出现次数', data: tags.map(x => x[1]), backgroundColor: '#719b96' }] },
      options: { ...common, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { color } }, y: { ticks: { color, autoSkip: false } } } }
    };
    const origins = {
      type: 'doughnut',
      data: { labels: ['今日日记', '当前笔记'], datasets: [{ data: [totals[1][1], totals[2][1]], backgroundColor: ['#d09a59', '#719b96'], borderWidth: 0 }] },
      options: { ...common, plugins: { legend: { labels: { color } } } }
    };
    const configs = [['记录趋势', trend], ['标签分布', distribution], ['写入方式', origins]];
    for (const [title, config] of configs) {
      const frame = charts.createDiv({cls:'sparkle-demo-chart'}); frame.createEl('h3',{text:title});
      const canvasHost = frame.createDiv({cls:'sparkle-demo-chart-canvas'});
      const chart = renderChart(config, canvasHost);
      if (chart) dv.component.register(() => chart.destroy());
    }
  } else root.createEl('p',{text:'启用 Charts 后显示交互图表。下方的统计表仍可使用。'});
  root.createEl('p', { text: '一条记录可有多个标签，因此标签次数之和会超过记录总数。', cls:'sparkle-demo-caption' });
  dv.table(['标签', '记录数'], tags);
  return;
}

const filters = root.createDiv({ cls:'sparkle-demo-filters' });
const field = (label, tag, type) => {
  const wrapper=filters.createEl('label'); wrapper.createSpan({text:label});
  return wrapper.createEl(tag,{attr:{'aria-label':label,...(type?{type}: {})}});
};
const search=field('搜索正文、标签、地点','input','search'); search.placeholder='例如：键盘、咖啡、Markdown…';
const tag=field('标签','select'); tag.createEl('option',{text:'全部标签',value:''});
for(const name of [...new Set(records.flatMap(r=>r.tags))].sort())tag.createEl('option',{text:name,value:name});
const kind=field('写入方式','select'); for(const [value,text] of [['','全部方式'],['daily','今日日记'],['file','当前笔记']])kind.createEl('option',{text,value});
const attachment=field('附件','select'); for(const [value,text] of [['','全部记录'],['image','带图片'],['geo','带位置'],['both','图片和位置'],['text','纯文字']])attachment.createEl('option',{text,value});
const from=field('开始日期','input','date'); const to=field('结束日期','input','date');
const limit=field('每页','select'); for(const size of [20,50,100])limit.createEl('option',{text:String(size),value:String(size)});
const reset=filters.createEl('button',{text:'重置筛选',attr:{type:'button'}});
if(mode==='images')attachment.value='image';
if(mode==='geo')attachment.value='geo';
if(mode==='filter')tag.value='#阅读';
const status=root.createDiv({cls:'sparkle-demo-result-count',attr:{role:'status','aria-live':'polite'}});
const cards=root.createDiv({cls:'sparkle-demo-cards'});
const footer=root.createDiv({cls:'sparkle-demo-pagination'});
const previous=footer.createEl('button',{text:'上一页',attr:{type:'button'}});
const pageLabel=footer.createSpan();
const next=footer.createEl('button',{text:'下一页',attr:{type:'button'}});
let page=0, epoch=0;

async function draw() {
  const token=++epoch;
  const text=search.value.trim().toLocaleLowerCase();
  const matches=records.filter(r=>(!text || `${r.body} ${r.header} ${r.path}`.toLocaleLowerCase().includes(text)) && (!tag.value || r.tags.some(t=>t===tag.value || t.startsWith(tag.value+'/'))) && (!kind.value || r.kind===kind.value) && (!from.value || r.date>=from.value) && (!to.value || r.date<=to.value) && (!attachment.value || (attachment.value==='image'&&r.image) || (attachment.value==='geo'&&r.geo) || (attachment.value==='both'&&r.image&&r.geo) || (attachment.value==='text'&&!r.image&&!r.geo)));
  const size=Number(limit.value), pages=Math.max(1,Math.ceil(matches.length/size)); page=Math.max(0,Math.min(page,pages-1));
  root.dataset.filteredRecords=String(matches.length);
  status.setText(`${matches.length} / ${records.length} 条记录 · ${new Set(matches.map(r=>r.path)).size} 篇笔记`);
  footer.hidden=pages<=1;
  previous.disabled=page===0; next.disabled=page>=pages-1; pageLabel.setText(`${page+1} / ${pages}`);
  cards.empty();
  if(!matches.length){cards.createEl('p',{text:'没有匹配的想法，试试放宽条件。'});return;}
  for(const record of matches.slice(page*size,(page+1)*size)){
    if(token!==epoch)return;
    const card=cards.createEl('article',{cls:'sparkle-demo-card'});
    const meta=card.createDiv({cls:'sparkle-demo-card-meta'});
    meta.createSpan({text:`${record.date} ${record.time}`});
    const link=record.path+(record.id?'#^'+record.id:'#'+(app.plugins.getPlugin('sparkle')?.settings?.heading||'Ideas'));
    meta.createEl('a',{text:`${record.kind==='daily'?'日记':'笔记'} · ${record.name}`,cls:'internal-link',attr:{href:link,'data-href':link}});
    const badges=card.createDiv({cls:'sparkle-demo-badges'});
    for(const label of record.tags)badges.createSpan({text:label});
    if(record.geo)badges.createEl('a',{text:'📍 '+record.geo.name,attr:{href:`geo:${record.geo.latitude},${record.geo.longitude}`}});
    const content=card.createDiv({cls:'sparkle-demo-card-body'});
    await dv.api.executeJs('dv.paragraph(' + JSON.stringify(record.body||'（仅记录位置）') + ');', content, dv.component, record.path);
  }
}
for(const element of [search,tag,kind,attachment,from,to,limit])element.addEventListener(element===search?'input':'change',()=>{page=0;void draw();});
reset.addEventListener('click',()=>{search.value='';tag.value='';kind.value='';attachment.value='';from.value='';to.value='';page=0;void draw();});
previous.addEventListener('click',()=>{page--;void draw();});next.addEventListener('click',()=>{page++;void draw();});
dv.component.register(()=>{epoch++;});
await draw();
