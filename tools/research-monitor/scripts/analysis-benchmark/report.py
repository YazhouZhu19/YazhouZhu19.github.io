"""Generate an inspectable repository report and export figure from measured results."""
import collections
import hashlib
import json
import os
from pathlib import Path
import statistics

os.environ.setdefault("MPLCONFIGDIR", "/private/tmp/oevryn-matplotlib")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

base = Path("eval/analysis-benchmark")
r = json.loads((base / "results.json").read_text())
manifest = json.loads((base / "manifest.json").read_text())
assert r["population"]["corpusSha256"] == manifest["corpusSha256"]
corpus = json.loads(Path("/private/tmp/oevryn-analysis-corpus.json").read_text())
rows = corpus["rows"]
source_counts = collections.Counter(v["kind"] for v in rows)
feature_rows = corpus["features"]
data_papers = sum(bool(v["data"]) for v in feature_rows)
code_papers = sum(bool(v["code"]) for v in feature_rows)
code_repos = len({c for v in feature_rows for c in v["code"]})
by_id = {v["id"]: v for v in rows}
labels = {"rules":"原规则标签向量", "tfidf":"TF-IDF + cosine", "bm25":"BM25", "nmf7":"NMF (K=7)", "lda7":"LDA (K=7)", "nmf20":"NMF (K=20)", "lda20":"LDA (K=20)"}
g = r["retrieval"]["github"]
def pct(v): return f"{100*v:.1f}%"
def interval(v): return f"{pct(v['mean'])} [{pct(v['ci95'][0])}, {pct(v['ci95'][1])}]"
lines = ["# OEVRYN 真实数据算法对比结果", "", "**结论：先补证据与词汇关联检索，保留规则作可解释标签；目前没有依据把 NMF 或 LDA 整体替换进页面。** 全程没有使用大语言模型或 AI 标注作为答案。", "", "该结论适用于本地已采集且通过现有筛选的快照。工程和计算校验通过；研究方向判断的准确性仍待人工专家评估。", "", "## 数据与范围", "",
f"原始输入 {manifest['inputPapers']:,} 篇论文、{manifest['inputSignals']:,} 条开源/动态记录。论文快照采集于 {manifest['collectedAt']}，来源快照生成于 {manifest['signalsGeneratedAt']}。筛选去重后保留 {r['population']['allRows']:,} 条历史记录，其中 {source_counts['paper']:,} 篇论文、{source_counts['github']:,} 个仓库、{source_counts['news']:,} 条动态。", "",
f"主流窗口内为 {r['baseline']['totals']['paper']:,} 篇论文、{r['baseline']['totals']['github']:,} 个最近更新仓库、{r['baseline']['totals']['news']:,} 条动态。主题实验训练 {r['population']['train']:,} 条、留出 {r['population']['test']:,} 条，按来源限制样本量，避免仓库数量主导训练。不是全量训练，也不是按真实领域比例抽样。", "",
f"{source_counts['paper']:,} 篇论文中 {r['population']['paperYears']['2026']:,} 篇（{pct(r['population']['paperYears']['2026']/source_counts['paper'])}）发表于 2026 年。仅 {data_papers} 篇包含规则可识别的数据资源链接，{code_papers} 篇链接到满足年龄/近期更新条件的 {code_repos} 个仓库。未发现满足跨一年重复数据链接条件的候选。部分来源状态为 partial，不能把缺失当作不存在。", "", "## 1. 主流主题：没有单一方法全面领先", "",
"统一口径采用各组训练文档的 TF-IDF 均值前十词，在同一留出集计算文档级 NPMI。另列模型原生词的结果，防止表示方式差异被掩盖。均值与范围来自三个初始化种子，范围不是置信区间。", "",
"| 方法 | 统一组均值 NPMI | 原生主题词 NPMI | 原生词多样性 | 种子匹配 Jaccard |", "|---|---:|---:|---:|---:|"]
series = []
for method,k in [("rules",7),("nmf",7),("lda",7),("nmf",20),("lda",20)]:
    runs = [x for x in r["topics"] if x['method']==method and x['k']==k]
    a=[x['centroidNpmi'] for x in runs]; b=[x['npmi'] for x in runs]
    st=[p['matchedWordJaccard'] for x in r['seedStability'] if x['method']==method and x['k']==k for p in x['pairs']]
    name="原规则（7 类）" if method=="rules" else f"{method.upper()} ({k})"
    def ran(v): return f"{statistics.mean(v):.3f}" + (f" [{min(v):.3f}, {max(v):.3f}]" if len(v)>1 else "")
    lines.append(f"| {name} | {ran(a)} | {ran(b)} | {statistics.mean(x['diversity'] for x in runs):.3f} | {statistics.mean(st):.3f}".rstrip() + " |" if st else f"| {name} | {ran(a)} | {ran(b)} | {statistics.mean(x['diversity'] for x in runs):.3f} | 固定规则，不作优越性比较 |")
    series.append((name,statistics.mean(a), min(a),max(a)))
lines += ["", "NPMI 衡量词语共现，不是方向正确率。规则类别允许重叠，学习模型取主导主题；两者的组粒度和拒绝机制不同。NMF 的结果中出现 DICOM/viewer/pacs 工具主题、radiology/business 新闻主题；LDA 也混合任务、器官、方法和通用论文词。这支持把主题模型用于候选发现，不支持自动把每个主题命名为一个研究方向。", "", "当前规则的主流窗口覆盖率（至少命中一类）为：", ""]
for kind in ["paper","github","news"]:
    total=r['baseline']['totals'][kind]; miss=r['baseline']['unmatched'][kind]
    lines.append(f"- {kind}：{total-miss:,}/{total:,}，{pct((total-miss)/total)}。")
lines += ["", "学习模型通常会对非空词表文本分配主题；这种高覆盖不能与规则的命中率直接等同于召回率。", "", "## 2. 论文—代码关联：词汇检索更值得优先加入", "",
f"全部历史数据中有 113 篇论文存在显式代码关联；其中 {g['queryCount']} 篇落在留出组件，连接 {g['positiveLinks']} 个查询—仓库对，候选库为 {g['gallerySize']:,} 个仓库。使用全部留出关联论文，不只限于上面的主题留出样本。输入网址、DOI 和 arXiv ID 已屏蔽。", "",
"| 方法 | 已知关联 Recall@10（95% 区间） | MRR |", "|---|---:|---:|"]
for name, m in g['metrics'].items():
    lines.append(f"| {labels[name]} | {interval(m['recall10'])} | {m['mrr']['mean']:.3f} |")
delta=g['pairedTfidfMinusBm25']['recall10']
lines += ["", f"TF-IDF−BM25 的配对 Recall@10 差为 {100*delta['mean']:.1f} 个百分点，95% 区间 [{100*delta['ci95'][0]:.1f}, {100*delta['ci95'][1]:.1f}]。不能仅凭点估计宣布二者存在可靠优劣。置信区间按关联组件重采样，独立组件数为 {delta['independentGroups']}。", "",
"规则向量只是原有七类规则的检索适配，不是原系统的真实链接关联功能。本表说明它作为细粒度匹配表征不够用，不能解读为“原系统总体准确率只有 3.7%”。低维主题向量也缺少区分具体项目的细节。", "",
"零命中方法的 bootstrap 区间会退化为 [0,0]，不表示总体真实命中概率精确为零。", "",
f"TF-IDF−BM25 的 MRR 差为 {g['pairedTfidfMinusBm25']['mrr']['mean']:.3f}，95% 区间 [{g['pairedTfidfMinusBm25']['mrr']['ci95'][0]:.3f}, {g['pairedTfidfMinusBm25']['mrr']['ci95'][1]:.3f}]：当前小样本对 TF-IDF 的首个相关项目排序更有支持，仍需新数据复核。", "",
"进一步屏蔽已知仓库标题词后：", ""]
for name,m in g['titleTokenMask'].items(): lines.append(f"- {labels[name]}：Recall@10 {interval(m['recall10'])}。")
lines += ["", "银标准只包含已有显式关联，存在选择偏差和未标注相关项目；不能用这些结果宣称自动新关联的精确率。新闻没有可用的显式论文关联，相关检索指标为不可评估，不记作 0%。", "", "## 3. 小众积累：主要瓶颈是证据，不是换聚类算法", "",
"下表列出候选经过每一项相同门槛的数量；各列并非逐步漏斗。规则为方向×问题×场景组合，模型为主导主题，候选粒度不同，数量不可作为质量排名。", "",
"| 候选方法 | 低占比候选 | 历史积累通过 | 逻辑词法线索通过 | 长期数据链接通过 | 成熟关联代码通过 | 全部通过 |", "|---|---:|---:|---:|---:|---:|---:|"]
for x in r['niches']:
    p=x['passEach']; lines.append(f"| {labels[x['method']]} | {x['candidateCount']} | {p['history']} | {p['logic']} | {p['data']} | {p['code']} | {x['passAll']} |")
lines += ["", "全部算法都没有通过长期数据证据门槛。原规则 303 个候选中，单独去掉任意一项门槛，完全合格数仍为 0，说明不是简单下调一个阈值就能解决。NMF/LDA 的部分组在去掉数据条件后可通过其他词法门槛，但这不能证明它们具备长期数据积累。", "", "## 4. 排序对规则参数的敏感性", "", "保持方向词典不变，观察主流阈值与来源权重变化：", "", "| 来源权重 | 阈值 3% | 阈值 5% | 阈值 7% |", "|---|---|---|---|"]
name_map={d['id']:d['label']['zh'] for d in r['baseline']['directions']}
for x in r['mainstreamSensitivity']:
    cells=["、".join(name_map[k] for k in x['mainstreamByThreshold'][str(t)]) or "无" for t in [.03,.05,.07]]
    lines.append(f"| {x['weights']} | {' | '.join(cells)} |")
lines += ["", "这不是寻找最佳参数；它揭示手设阈值和来源权重会改变页面结论。论文、代码和动态不是三个相互独立的研究力量投票。", "", "## 采取的改进决策", "",
"1. **关联层优先引入 TF-IDF/BM25 候选检索，保留显式链接为可核实证据。** 先以离线建议方式运行；由人工审核新增关联，再评估 Precision@K。不要把文本相似直接写成“这篇论文的官方代码”。本轮两者的差异不足以确立唯一胜者。",
"2. **保留规则标签，NMF/LDA 只作为候选发现的并行实验。** 先补领域停用词、短语和来源样式处理，并建立独立人工标注，再检验是否改善。不能因为某个 NPMI 更高就直接替换页面。",
"3. **小众方向改成“证据充分 / 待补证据 / 有反证”的区分。** 当前大量缺失只能进入待补证据。补充至少数年的论文历史、数据集版本与 DOI、仓库 release/commit 时间序列、论文—数据—代码显式关系；再判断持续积累。暂不靠放宽阈值制造合格方向。",
"4. **问题、方法、场景继续保留原文出处。** TextRank 可作为证据句抽取候选，尚未实测；完整研究逻辑需要人工证据句/关系标注，不能用“包含四类词”冒充验证。",
"5. **建立新人工留出集后再作正式选型。** 主流方向评多标签 F1 和专家排序 nDCG；小众候选评 Precision@K、证据完整度及边界例；未知总体无法可靠估计真实小众召回率。两位评审分别标注并仲裁，禁止把历史 AI 草拟标签提升成金标准。", "",
"本轮提交的是实验基准与决策依据，没有替换生产页面的分析规则。", "", "## 复查入口", "",
"- [完整设计、算法文献、指标定义与复现命令](README.md)",
"- [全部数值、词列表、样例和候选明细](results.json)",
"- [冻结参数](protocol.json)、[数据指纹与来源状态](manifest.json)、[数据划分与检索逐条得分](split.json)",
"- [待人工标注的原文任务](human-review.jsonl)；没有预填任何质量标签。", "",
"![真实数据检索对比](comparison.png)", "",
"图中区间是小样本、组件级 bootstrap 区间，只反映当前已知关联测试的不确定性；它不是实际研究方向准确率。"]
(base / 'report.md').write_text('\n'.join(lines)+'\n')

# A compact export figure for this scientific experiment, with no implied accuracy.
names=['rules','tfidf','bm25','nmf7','lda7','nmf20','lda20']
values=[g['metrics'][m]['recall10'] for m in names]
fig,ax=plt.subplots(figsize=(10.5,5.8))
fig.subplots_adjust(left=.18,right=.97,top=.86,bottom=.19)
means=[v['mean']*100 for v in values]
errors=[[100*(v['mean']-v['ci95'][0]) for v in values],[100*(v['ci95'][1]-v['mean']) for v in values]]
ax.barh(range(len(names)),means,xerr=errors,capsize=4,color=['#64748b','#0f766e','#2563eb','#94a3b8','#94a3b8','#94a3b8','#94a3b8'])
ax.set_yticks(range(len(names)),['Rule-label cosine','TF-IDF cosine','BM25','NMF, K=7','LDA, K=7','NMF, K=20','LDA, K=20'])
ax.invert_yaxis(); ax.set_xlim(0,108)
ax.set_xlabel('Known-link Recall@10 (%) — not research-direction accuracy')
ax.set_title(f"Paper → repository retrieval | {g['queryCount']} held-out papers / {g['gallerySize']:,} repositories",loc='left',fontweight='bold',pad=16)
for i,m in enumerate(means): ax.text(min(101,values[i]['ci95'][1]*100+2),i,f'{m:.1f}%',va='center',fontsize=10)
ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.18);ax.set_axisbelow(True)
fig.text(.01,.025,'URLs and IDs masked. Bars: query mean. Whiskers: 95% component-bootstrap interval. Snapshot: 2026-11-09.',fontsize=9,color='#475569')
fig.savefig(base/'comparison.png',dpi=180,bbox_inches='tight');fig.savefig(base/'comparison.svg',bbox_inches='tight');plt.close(fig)

# Unlabelled, method-hidden evidence packets, not a gold standard.
split=json.loads((base/'split.json').read_text()); tasks=[]; key=[]
for kind in ['paper','github','news']:
    ids=sorted([i for i in split['testIds'] if by_id[i]['kind']==kind],key=lambda s:hashlib.sha256(s.encode()).hexdigest())[:20]
    for i in ids:
        row=by_id[i]; tid=f"record-{len(tasks)+1:03}"
        tasks.append({'taskId':tid,'type':'record','kind':kind,'title':row['title'],'url':row['url'],'text':row['text'],'humanConfirmed':False,'reviewer':None,'directions':None,'problemEvidence':None,'methodEvidence':None,'scenarioEvidence':None,'outOfScope':None})
for result in r['niches']:
    candidates=sorted(result['candidates'],key=lambda c:hashlib.sha256(c['id'].encode()).hexdigest())[:6]
    for c in candidates:
        tid=f"niche-{len(tasks)+1:03}";members=sorted(c['paperIds'],key=lambda i:(by_id[i]['date'],i)); chosen=members if len(members)<=12 else members[:6]+members[-6:]
        tasks.append({'taskId':tid,'type':'niche','memberIds':members,'evidenceSubset':len(chosen)<len(members),'papers':[{k:by_id[i][k] for k in ['id','title','url','date','text']} for i in chosen],'codeIds':c['codeIds'],'humanConfirmed':False,'reviewer':None,'coherentDirection':None,'completeResearchLogic':None,'longitudinalDataEvidence':None,'longitudinalCodeEvidence':None,'judgment':None,'evidenceNotes':None})
        key.append({'taskId':tid,'method':result['method'],'candidateId':c['id']})
(base/'human-review.jsonl').write_text(''.join(json.dumps(t,ensure_ascii=False)+'\n' for t in tasks))
(base/'human-review-key.json').write_text(json.dumps(key,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'report':str(base/'report.md'),'reviewTasks':len(tasks),'figure':str(base/'comparison.png')}))
