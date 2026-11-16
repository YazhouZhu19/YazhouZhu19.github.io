# OEVRYN 非大语言模型算法对比

本目录保存真实快照上的诊断实验，不是人工专家确认的方向识别准确率。
阅读 [实验结果与改进决策](report.md)，复算见下方。现有页面算法没有被替换。

## 研究问题与成熟方法

| 子任务 | 方法与出处 | 本次处理 |
|---|---|---|
| 发现研究主题 | [NMF / LDA 官方示例](https://scikit-learn.org/1.6/auto_examples/applications/plot_topics_extraction_with_nmf_lda.html)、[LDA 原论文](https://www.jmlr.org/papers/v3/blei03a.html) | 与原规则共同运行；K=7、20，各 3 个种子 |
| 找回论文对应代码 | TF-IDF 余弦、[BM25 原理与实现](https://arxiv.org/html/0911.5046)、[Lucene BM25 默认参数与 IDF](https://lucene.apache.org/core/9_12_3/core/org/apache/lucene/search/similarities/BM25Similarity.html) | 与规则标签向量、NMF/LDA 主题向量比较 |
| 主题一致性评价 | [Lau、Newman、Baldwin 2014](https://aclanthology.org/E14-1056/) | 采用文档级 NPMI 变体；不是原文滑窗实验的复现 |
| 抽取原文证据句 | [TextRank，2004](https://aclanthology.org/W04-3252/) | 已检索，未实测；缺少人工证据句标准，不能用词重叠冒充语义正确性 |
| 识别短期热度突发 | [Kleinberg，2002](https://www.cs.cornell.edu/home/kleinber/bhs.pdf) | 已检索，未实测；不适合用来证明长期数据与代码积累，当前采集历史也不均衡 |

NMF 分解 TF-IDF 矩阵 X≈WH，使用非负约束及 Frobenius 损失；LDA 将文档建模为主题的概率混合，输入词频。两者用 scikit-learn 1.6.1 的公开实现，没有预训练语言模型。TF-IDF 与 BM25 是词汇匹配，不做语义生成。本次没有调用 LLM、向量嵌入服务，也没有读取 `eval/relevance-*-annotations.json` 等 AI 草拟标签。

## 实验设计

1. **冻结快照与参数。** 使用仓库已有真实论文、GitHub、动态快照；截止日 2026-11-16，主流窗口 2025-11-17 至 2026-11-16。`manifest.json` 保存快照采集日期、来源状态、语料和引擎 SHA-256；`protocol.json` 在首次训练前写入 K、种子、阈值、训练上限等参数。它是本地实验计划，不是第三方预注册。
2. **保持基础筛选一致。** 继承现有 core / direct 规则、日期检查、作品 ID 去重、仓库 URL 及动态原始 URL 去重。结论只适用于这个条件样本，不能据此验证上游规则的召回率，也不能代表整个医学影像领域的真实研究力量。
3. **分组留出。** 显式 DOI/arXiv/仓库链接与规范化全文完全重复项连接成组件；按组件最小 ID 的 SHA-256 前 8 位取模 5，0 为测试。每类来源按 ID 哈希最多取 1,600 条训练、400 条测试。训练与测试无组件交叉。仍可能存在未发现的近重复，测试不是前瞻时间验证。
4. **统一文字处理。** 标题+原始摘要、项目描述/README 摘录或新闻摘要；移除网址、DOI、arXiv ID、HTML。英文词法、scikit-learn 英文停用词表，单词长度至少 3，min_df=3、max_df=.95，词表最多 6,000。仅在训练集拟合词表及 TF-IDF。中文信息不会被完整建模，不能外推为中英文等效性能。
5. **主题实验。** NMF 使用 `nndsvdar` 初始化、max_iter=400；LDA 使用 batch 变分推断、max_iter=20；种子 42/43/44。所有结果保留，不按测试指标调参选 K。原规则七个多标签类别不重新训练。规则主题词取训练成员 TF-IDF 均值前十；模型原生主题词与统一 TF-IDF 组均值主题词分别报告。统一口径下，NMF/LDA 按主导主题分组，规则允许重叠，这一差异仍存在。
6. **跨来源关联实验。** 测试组件中的论文作查询，全部合格历史 GitHub 记录作候选库。显式链接只产生不完整的银标准，输入文本中全部去掉链接及标识符。规则使用七维标签向量余弦，这是为对比增加的适配基线，并非原页面已经实现了模糊匹配。原有“直接链接命中”不会参与打分，否则与银标准同义而得到虚假的满分。新闻无显式关联样本，标为不可评估。
7. **小众实验。** 原方向×问题×场景组合，与模型主导主题生成的低占比组分别作为候选；都经过相同历史/逻辑线索/数据/代码四道证据门槛。基准实现逐项复核全部 303 个原规则候选的数量、跨度、逻辑线索数、数据跨度及 ready 状态。不同候选粒度不能用数量多寡判断优劣。

## 指标口径

- 文档级 NPMI：对每个主题前 10 词的 45 个词对，在留出文本中计算 `log(P(a,b)/(P(a)P(b)))/-log(P(a,b))` 后平均；从未共同出现的词对记为 -1。各主题等权。这是词共现代理，不能证明研究逻辑成立。
- 主题多样性：不同主题词数/(K×10)，仅针对模型原生主题词；高值也可能来自噪声。
- 种子稳定性：以最大总 Jaccard 的匈牙利匹配对齐主题词，同时报告留出文档主导主题的 ARI。这只测初始化变化；固定规则的稳定不代表正确，NMF 的稳定初始化也不代表采样鲁棒。
- Recall@10：每个查询前十结果中找回的已知关联仓库数/该查询已知关联仓库总数，再对查询平均。不是对全部真实相关仓库的召回率，也不是推荐准确率。
- MRR：第一个已知关联仓库排名的倒数，查询等权平均。零相似度不算找到；同分按候选 ID 排序，因此低维规则的大量同分会被惩罚。
- 不确定性：2,000 次以关联组件为单位的 bootstrap，输出 95% 百分位区间；方法差使用相同组件进行配对。样本很小，不把区间当作全领域保证。
- BM25：k1=1.2、b=.75，Lucene 风格正 IDF `log(1+(N-df+.5)/(df+.5))`，词频项乘 (k1+1)。长度使用完整分词后的长度，查询词按存在/不存在计数；检索词限定于共同 6,000 词表，因此不是完整 Lucene 搜索系统的跑分。
- 检索压力测试：进一步从论文查询中屏蔽已知关联仓库标题包含的词，单独报告 TF-IDF/BM25。该诊断使用银标准生成更困难输入，不能作为部署算法。
- 小众门槛：占比<10%；至少 3 篇作品、730 天跨度、3 个年份；至少 2 篇有问题/方法/实验/结果词法线索；同一开放数据链接跨度至少 365 天；明确关联非归档仓库创建≥730天、近365天有 push。代码最近 push 不是连续维护证明，共享数据链接也不是新增数据证明。

## 可复现运行

在 `tools/research-monitor` 目录运行，使用 Node≥22.13 和 Python 3.9 的独立虚拟环境：

```sh
python3 -m venv /private/tmp/oevryn-benchmark-venv
/private/tmp/oevryn-benchmark-venv/bin/python -m pip install -r scripts/analysis-benchmark/requirements.txt
node --import tsx scripts/analysis-benchmark/export.ts
/private/tmp/oevryn-benchmark-venv/bin/python -m unittest discover -s scripts/analysis-benchmark -p 'test_*.py' -v
/private/tmp/oevryn-benchmark-venv/bin/python scripts/analysis-benchmark/run.py
/private/tmp/oevryn-benchmark-venv/bin/python scripts/analysis-benchmark/report.py
node --import tsx --test tests/integrated-analysis.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

`export.ts` 默认把完整审计语料写入 `/private/tmp/oevryn-analysis-corpus.json`，不复制进版本库；需保留原仓库数据分片以复现。随机种子、软件版本、训练测试 ID 均写入结果。运行时间依赖机器。

## 实现校验与限制

先完成了两轮实现校验，最终重跑修正了四项评估口径：规则向量也屏蔽标识符、零词表文档不进入学习主题份额、增加各方法统一 TF-IDF 均值的主题指标、BM25 使用完整分词长度及组件级 bootstrap。算法 K、种子、阈值未按结果调优。初轮结果已经被查看，因此这不是完全盲测；所有最终数值以当前 `results.json` 为准。

人工准确率、完整研究逻辑、数据持续新增、代码与具体论文的真实实现关系，尚未获得领域专家金标准。现有 AI 草拟标注不能补齐这些缺口。`human-review.jsonl` 保留匿名任务和原文，`human-review-key.json` 单独保存方法来源，标签全部留空。后续需要双人盲评、争议仲裁，并保留新的未触碰测试集；再计算多标签 F1、主流排序 nDCG、小众 Precision@K 和漏检率。没有总体真实小众清单时仍不能声称测得其召回率。
