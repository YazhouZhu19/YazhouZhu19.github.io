# 400 篇临时相关性标注：AI 二次复核

**状态：AI 辅助二次复核，仍为临时建议；不是人工金标准，不替代维护者确认门禁。**

复核日期：2026-10-21。冻结证据 SHA-256：`12f32a22fa27f29f582a6f8c2b6f7556c7490cec030e80d0431c2037bee7e124`。

已逐项阅读冻结的 400 个题名，其中 369 条含完整摘要、31 条无摘要。逐批根据证据形成判断，再对照 `relevance-annotations.json`；最后验证全部原值与 `relevance-sample.csv` 一致。最初文件结构检查暴露了前批部分原标签，因此本复核不是完全盲法，也不声称专家间一致性。没有查阅全文、联网或外发资料。程序只用于展示批次、保存逐条决定及校验，未用分类器正则批量推断标签。

## 审阅覆盖与结果

| 状态 | 条数 | 含义 |
| --- | ---: | --- |
| 暂未发现具体更正（agree） | 217 | 仍是AI判断，不表示人工确认 |
| 有明确证据的建议更正（change_suggested） | 67 | 等待维护者裁定 |
| 定义或证据边界待确认（boundary_review_required） | 85 | 建议值是条件性意见 |
| 缺摘要、仅题名待核（missing_abstract_unverified） | 31 | 不得视为已核实标签 |
| 合计 | 400 | 400 个唯一 ID，覆盖 100% |

共有 113 条给出与原值不同的条件性或明确建议，其中 11 条涉及 scope、107 条涉及 track（两者可重叠）。这不是已确认错误数，更不能据此计算真实准确率。31 条缺摘要已全部保留未核实状态。原样本、原 annotations、评估报告、代码与数据均未由本复核修改。

## 主要发现

1. **实际下游任务经常漏标。** ASAP（#5）、RadJEPA（#61）、COLIPRI（#215）实际评价分类与分割；GliomaINK（#94）实际评价分割、分子状态和生存。不能仅因为论文主标题是预训练或重建就忽略这些已验证任务。
2. **human_loop 的漏标与过标并存。** OncoVision（#151）、Cerebra（#222）、EyeAgent（#274）、SLIP（#357）有明确医生辅助或真实专家用户实验。单纯真假图判断（#88）、AI与医生独立比较（#33、#43）、没有实际操作者证据的标题/点击预算（#15、#283）应区别处理。
3. **scope 不能只看有无新算法。** #111 的心室破裂病例以影像病因证据为核心，#137 的皮瓣病例以CT体积变化为核心，建议 out→adjacent。#156 的FUS研究明确不用成像完成对准，计算声学并不自然等同计算医学影像，建议 core→out。其余8项scope差异仍受边界或缺摘要限制。
4. **量化、分子状态、预后应区分。** BRAF/IDH分类不是未来生存预测；同步转移（#277）是当前病情判断。比较两种影像引导治疗方式的结局（#235）不是影像预后模型。治疗中/后的影像变化（#340）及未来扫描合成（#100、#236、#354）是否归prognosis，需要先固定时间及终点口径。
5. **prompt、agent、foundation 不是自动标签。** #271只有涂鸦提示，应去language；#371用LLM构建软件而非图文影像理解，#395只描述有界软件代理，也不足支持language。基础模型单任务应用与基础模型方法贡献的纳入规则仍不一致。

## 建议先统一的边界

| 边界 | 需维护者固定的口径 | 代表项 |
| --- | --- | --- |
| 多标签粒度 | 除主要任务外，是否纳入已实际评估的下游任务，以及仅作为预处理/辅助的算法步骤；两类应分别规定 | #5、#61、#67、#165、#319、#343 |
| 临床人机协作 | 真实辅助/修正实验、模型独立对照、人评图像质量、真实标注用户研究、模拟点击分别如何计入 | #15、#33、#88、#141、#212、#221、#283、#357 |
| 预后 | 要求未来临床终点，还是也纳入未来影像生成、观察到的时间变化和治疗组结局比较 | #11、#100、#235、#236、#340、#354 |
| 定量影像 | 定量参数图/体积、半定量分级、选帧/时相定位、算法不确定性和图像质量指标应分别处理 | #48、#102、#161、#233、#351、#360 |
| 分子分类 | 影像预测分子状态应计quantification；何时还计diagnosis | #94、#159、#391 |
| 基础模型 | 通用预训练/基准、SAM适配、冻结基础特征器、自然图像骨干单任务微调是否同样纳入 | #143、#168、#177、#186、#237、#341、#392 |
| 综述与协议 | 聚焦计算方法综述、广泛医学AI综述、临床成像参考、无结果的研究/操作协议 | #32、#160、#213、#273、#314、#380、#381 |
| 医学影像范围 | 生物/兽医显微、单体素MRS、探测器信号处理、采集机器人与非医学CT对象 | #43、#71、#239、#261、#313、#317、#331 |

## 有明确证据的建议更正

以下为67条具体建议，不直接合并回原标签。部分记录的次要标签仍依赖上述统一口径，详见逐条理由。完整原值、建议值、短引文和状态均在 `second-review.json`。

| 序号 / ID | 原值 → 建议值 | 证据与理由 |
| --- | --- | --- |
| 5 · `arxiv:2606.00602` | core / foundation; language → core / foundation; language; diagnosis; segmentation; prognosis | 摘要明确评估下游分类、分割、预后，不是背景用语，应补入。 |
| 19 · `arxiv:2608.16233` | core / reconstruction → core / reconstruction; diagnosis; human_loop | 另有200例癌症诊断准确性及1000例读片实验，补诊断；human_loop按模型输出读片评估口径收录。 |
| 34 · `doi:10.64898/2026.08.13.26360270` | core / intervention → core / intervention; segmentation; human_loop | 明确概率分割电极且7条电极用工具人工修正；补分割与交互。 |
| 35 · `arxiv:2607.03593` | core / diagnosis; quantification → core / diagnosis; quantification; segmentation | 实际流水线包含深度分割，应补入。 |
| 51 · `doi:10.64898/2026.09.10.26362169` | core / registration; quantification → core / registration; quantification; reconstruction; segmentation | 实际六阶段包含深度插值与自动肾分割，应补重建/分割。 |
| 61 · `arxiv:2601.15891` | core / foundation; language → core / foundation; language; diagnosis; segmentation | 摘要明确做分类和分割迁移实验，补真实下游任务。 |
| 66 · `doi:10.1007/s10278-026-02241-2` | core / reconstruction → core / reconstruction; segmentation | 除恢复外明确评估下游解剖分割Dice，按实际评估任务应补分割；PHI文本检测不属疾病诊断。 |
| 67 · `doi:10.21037/cdt-2025-1-653` | core / diagnosis; quantification; prognosis → core / diagnosis; quantification; prognosis; segmentation | 实际流水线使用U-Net冠脉自动分割，补入。 |
| 68 · `doi:10.64898/2026.07.16.26356882` | core / human_loop → core / human_loop; diagnosis | 临床AI引导采集与远程读片之外，实际DVT诊断准确性也是终点。 |
| 70 · `doi:10.1148/ryct.250521` | core / reconstruction; registration; diagnosis → core / reconstruction; registration; diagnosis; human_loop | 医生在原图与原图+生成图条件下诊断比较，符合辅助读片。 |
| 79 · `arxiv:2509.23097` | core / foundation → core / foundation; diagnosis | 六项病理下游任务且报告诊断准确性，应补diagnosis。 |
| 80 · `doi:10.1007/978-3-032-06329-8_3` | core / reconstruction; intervention → core / reconstruction | 实际验证MRI生成超声；导航/配准被表述为下游用途，未报告治疗或导航实验。 |
| 84 · `arxiv:2512.03449` | core / segmentation; quantification → core / segmentation; quantification; diagnosis | 实际OA与非OA分类并报告AUC，不应遗漏diagnosis。 |
| 88 · `doi:10.64898/2026.06.25.26356440` | core / reconstruction; human_loop → core / reconstruction | 专家判断图像真假是生成质量/来源评估，没有疾病诊断或工作流辅助，去human_loop；与MedForj/PanoDiff一致。 |
| 94 · `arxiv:2610.24044` | core / reconstruction → core / reconstruction; segmentation; quantification; prognosis | 明确报告分割、IDH1分子状态及生存下游任务，应补三项。IDH1归quantification；是否另计diagnosis需与391的BRAF分类统一。 |
| 111 · `doi:10.18502/jthc.v20i2.19711` | out / ∅ → adjacent / ∅ | 病例以多模态成像识别破裂与病因为核心证据，无计算方法只能排除core，不能据此排除adjacent。 |
| 125 · `arxiv:2506.10633` | core / reconstruction → core / language; diagnosis | 实际目标为图文对齐、phrase grounding及疾病分类；使用扩散骨干不代表评估图像生成。 |
| 133 · `doi:10.1016/j.jdent.2026.107087` | core / segmentation; registration; intervention → core / segmentation; registration; intervention; human_loop | 三位医生在传统与PIM辅助规划两条件下实际比较，应补human_loop；多模态融合的registration细节仍有限。 |
| 137 · `doi:10.53045/jprs.2025-0100` | out / ∅ → adjacent / quantification | 核心贡献是5年CT体积随访与体重关联，应adjacent且quantification；没有算法只能排除core。 |
| 148 · `arxiv:2508.20734` | core / registration → core / registration; segmentation; quantification | 模型联合分割和运动估计，并实际评估临床指标提取，应补两track。 |
| 151 · `arxiv:2511.19667` | core / diagnosis; segmentation → core / diagnosis; segmentation; quantification; human_loop; language | 实际影像组学、六位医生辅助读片、结构化报告输出均漏标；language按结构化报告生成口径。 |
| 154 · `doi:10.1007/s10278-026-02329-9` | core / diagnosis → core / diagnosis; human_loop | 明确医生AI辅助前后AUC提升，应补HIL。 |
| 156 · `arxiv:2606.05628` | core / intervention → out / ∅ | 实际治疗声学设计/对准不使用成像，摘要明确无成像需求；不是计算医学影像贡献。 |
| 159 · `arxiv:2606.04792` | core / diagnosis; foundation; human_loop → core / diagnosis; foundation; human_loop; quantification; prognosis | 已报告明确交叉读片结果，无需仅称动机；另有分子表型及预后任务，应补量化和预后。 |
| 162 · `arxiv:2504.15928` | core / diagnosis; foundation → core / diagnosis; foundation; human_loop | 有31名眼科医生前瞻可用性评估，应补临床人机工作流。 |
| 166 · `arxiv:2508.12226` | core / reconstruction → core / reconstruction; quantification | 输出组织声学参数空间图，定量影像是实际目标。 |
| 175 · `arxiv:2511.02086` | core / registration; intervention → core / registration; intervention; human_loop | 真实术中七次试验含人工引导初始化，符合交互临床工作流。 |
| 187 · `doi:10.5624/isd.20260079` | core / quantification → core / quantification; segmentation | 明确训练U-Net并用于7832张影像，补分割。 |
| 190 · `doi:10.1016/j.media.2026.104335` | core / registration; reconstruction → core / registration; reconstruction; segmentation | 明确评估下游分割，应与其他重建下游标签统一。 |
| 202 · `doi:10.1007/s00259-026-08190-w` | adjacent / quantification → adjacent / quantification; diagnosis | 除SUV关联外实际评估AS/DJD等鉴别AUC，应补诊断准确性。 |
| 208 · `doi:10.1148/rycan.250617` | core / prognosis → core / prognosis; quantification; language | 实际使用CT影像组学及LLM病理报告嵌入，补量化与图文多模态；不是病理图像输入。 |
| 209 · `arxiv:2509.12090` | core / registration; reconstruction → core / registration; reconstruction; intervention | 在私人介入数据及术中稀疏采样场景实际验证，应补intervention。 |
| 215 · `arxiv:2510.15042` | core / language; foundation → core / language; foundation; segmentation; diagnosis | 摘要明确分割、分类与报告生成均评估。 |
| 218 · `doi:10.64898/2026.07.30.26359276` | core / registration; quantification → core / registration; quantification; segmentation | 五种实际比较算法含U-Net分割，结果报告其深度估计表现，补分割。 |
| 222 · `arxiv:2603.21597` | core / diagnosis; prognosis; language → core / diagnosis; prognosis; language; human_loop | 明确经验医生读片研究且AI提高风险估计准确度，补HIL。 |
| 229 · `arxiv:2503.00972` | core / registration; intervention → core / registration; intervention; segmentation | 实际测试AI自动分割配准流水线，应补segmentation。 |
| 235 · `doi:10.1016/j.amjcard.2026.09.014` | adjacent / intervention; prognosis → adjacent / intervention | 比较影像引导治疗组的结局，没有影像特征预测模型/预后标志物，去prognosis。 |
| 236 · `arxiv:2604.22700` | core / reconstruction; prognosis; foundation → core / reconstruction; prognosis; diagnosis; segmentation | 并非基础模型，未描述大规模通用预训练，应去foundation；实际下游疾病分类和分割应补。未来影像对应prognosis边界同100。 |
| 240 · `arxiv:2602.19213` | core / segmentation → core / segmentation; foundation | SAM通用医疗适配、跨模态零样本性能，与已纳入的SAM类一致应补foundation。 |
| 244 · `arxiv:2501.12632` | core / diagnosis → core / diagnosis; language | 文本到局部特征的跨模态对齐为核心且在病理验证，应补language。 |
| 254 · `arxiv:2505.11909` | core / segmentation → core / segmentation; reconstruction | 实际先生成目标源风格图像再分割，跨模态合成是方法组成。 |
| 259 · `doi:10.1002/jfa2.70226` | adjacent / prognosis → adjacent / prognosis; quantification | 基于负重X线角度量化并预测术后功能，应与其他手工形态指标统一加quantification。 |
| 262 · `arxiv:2510.23224` | core / language → core / language; diagnosis; human_loop | 除检索外八项疾病评估且多中心医生辅助读片有结果，补diagnosis/HIL；HCC risk是否未来预测未明不加prognosis。 |
| 267 · `doi:10.64898/2026.08.03.26359612` | core / registration → core / registration; intervention; quantification | 实际肝消融前后数据，评价最小消融边界，补介入与边界量化。 |
| 269 · `arxiv:2610.18926` | core / registration; intervention → core / registration; intervention; human_loop; language | 使用临床文本并经盲法临床轮廓可接受性/编辑耗时评估，补语言及临床读者反馈。 |
| 271 · `arxiv:2507.00673` | core / segmentation; language → core / segmentation | 提示为用户涂鸦图像，没有文本语言模块；去language。 |
| 274 · `arxiv:2511.09394` | core / diagnosis; language → core / diagnosis; language; human_loop | 明确医生获AI辅助后的诊断/报告改善，应补HIL；工具库分割/生成/量化是否逐项实测未充分。 |
| 288 · `doi:10.64898/2026.06.16.26355800` | core / quantification; prognosis → core / quantification; prognosis; segmentation; diagnosis | 明确多任务U-Net检出/分割BAC并报告AUROC与Dice，补分割和检测。 |
| 291 · `arxiv:2610.06094` | core / reconstruction; intervention → core / reconstruction | 仅图像质量/ROI指标；放疗是潜在用途，未评估计划、剂量或导航，去intervention。 |
| 292 · `arxiv:2512.17080` | core / reconstruction → core / reconstruction; diagnosis | 合成图像效用方法实际改善多模态疾病分类，应补diagnosis。 |
| 299 · `doi:10.1109/tuson.2026.3687801` | core / reconstruction → core / reconstruction; quantification | 直接输出声速参数空间图，按定量US/MRI一致口径补quantification。 |
| 301 · `arxiv:2604.23481` | core / diagnosis → core / diagnosis; segmentation | 核类型分类之外明确评价分割性能，应补分割。 |
| 312 · `doi:10.1109/tuson.2026.3683326` | core / reconstruction → core / reconstruction; registration | GPU流水线明确含运动校正，按实际实现pipeline任务补registration。 |
| 315 · `doi:10.1227/neuprac.0000000000000216` | adjacent / diagnosis → adjacent / quantification | 实际报告影像尺寸/体积及标志出现率，诊断标准用途留待未来研究，删除diagnosis补quantification。 |
| 319 · `arxiv:2607.20037` | core / reconstruction → core / reconstruction; registration | 数据构建明确执行可变形配准与投影模拟，补registration；放疗采集背景不自动加介入。 |
| 324 · `arxiv:2607.19099` | core / reconstruction → core / reconstruction; quantification | 实际实现T1/R2*/B0参数映射并验证，应补quantification。 |
| 338 · `arxiv:2605.02720` | core / language; foundation → core / language; foundation; diagnosis | 实际110项临床任务的分类AUROC评估，补diagnosis。 |
| 342 · `arxiv:2608.00831` | core / registration; intervention; foundation → core / registration; intervention; foundation; reconstruction | 配准迁移生成预测CT是实际输出，补reconstruction；未来解剖不自动等于临床预后。 |
| 348 · `arxiv:2605.16980` | core / segmentation; quantification → core / segmentation; quantification; reconstruction; registration | 实际GAN去伪影、表面恢复、非刚性配准及形态PCA，补重建/配准。 |
| 357 · `arxiv:2607.22332` | core / segmentation → core / segmentation; human_loop | 明确前瞻六名专家真实用户对照，不是单纯专家标注或模拟点击，应补HIL。 |
| 361 · `doi:10.3390/diagnostics16152385` | core / reconstruction → core / reconstruction; segmentation | 明确合成增强后nnU-Net分割Dice实验，补segmentation。 |
| 362 · `doi:10.64898/2026.08.27.26361537` | core / quantification → core / quantification; diagnosis | CTA-CFD压力量化之外报告血流动力学显著狭窄的敏感度/特异度，补diagnosis。 |
| 364 · `arxiv:2606.18887` | core / registration → core / registration; reconstruction | 配准方法实际用于超分辨ULM成像并报告分辨率，补重建应用任务。 |
| 367 · `arxiv:2609.28081` | core / registration → core / registration; quantification | 实际报告射血分数量化误差改善，补quantification。 |
| 371 · `doi:10.64898/2026.08.03.26359608` | core / diagnosis; language → core / diagnosis | LLM用于构建和修改乳腺AI软件，未做图文理解/报告；去language。医生与模型独立比较也不是HIL协作证据。 |
| 395 · `doi:10.3390/s26154817` | core / segmentation; language → core / segmentation | 六个模块为有界软件代理，未描述LLM/图文处理；agentic不能自动推出language。合成叠加也不支持HIL/临床预后。 |
| 397 · `doi:10.1007/s00234-026-04135-0` | core / diagnosis; human_loop → core / diagnosis; human_loop; quantification | 明确手工及深度影像组学融合并验证，补quantification。 |

## 不确定边界清单

以下85项逐条保留条件性判断，不能当作已经证实的更正。相同值的条目也可能需要确认研究类型或纳入范围。

| 序号 / ID | 条件性建议 | 未决点 |
| --- | --- | --- |
| 2 · `arxiv:2605.09977` | core / reconstruction; registration | 神经表示图谱构建明确属core；传统非刚性配准被绕过，registration可作为图谱对齐任务保留但应确认。 |
| 11 · `arxiv:2606.15938` | core / language; foundation | 对两次已获得影像的进展分类/描述不等于未来进展预测，建议去prognosis；预训练支持foundation但需统一规模口径。 |
| 14 · `arxiv:2602.19322` | core / foundation; diagnosis | 明确有分类线性探针但未逐项列疾病标签；建议核实后补diagnosis。 |
| 15 · `arxiv:2607.29266` | core / segmentation | 标题称HITL而摘要仅展示用户界面与案例，没有临床人员反馈/修正实验；human_loop证据不足。 |
| 20 · `doi:10.13703/j.0255-2930.20250418-k0002` | core / reconstruction; intervention; quantification | 软件重建符合当前core口径；核心输出为距离/角度量化，建议补quantification，常规重建边界需确认。 |
| 26 · `doi:10.64898/2026.07.07.26357474` | core / diagnosis; quantification | 癌症检测明确；联合输出乳腺密度可视定量标志物，但密度分类是否计quantification需统一。 |
| 32 · `arxiv:2606.16153` | core / segmentation | 聚焦计算分割方法综述，按临时综述口径保留core。 |
| 33 · `doi:10.32687/0869-866x-2026-34-4-851-856` | core / diagnosis | AI与医生独立判断的一致性比较，未测AI辅助医生；human_loop限定协作时应删除。 |
| 36 · `doi:10.64898/2026.08.17.26360254` | core / human_loop; quantification | AI生成184个值且48个被修正，但未列明数值类别，quantification待核。 |
| 37 · `arxiv:2604.21636` | core / reconstruction; intervention | 乳腺边缘超分辨成像仅在仿体验证；core/adjacent取决于硬件采集与计算重建边界。 |
| 41 · `arxiv:2602.10155` | core / registration; intervention | 计算配准综述按临时口径core，有明确术中导航主题。 |
| 43 · `doi:10.1111/vru.70252` | core / diagnosis; language | 兽医纳入需确认；医生和模型独立评分，没有辅助医生条件，建议去human_loop。 |
| 46 · `arxiv:2607.12896` | core / segmentation; foundation; language | 明确语言引导分割已实际评估，若语言条件分割属language则补入；提示不等于人机临床验证。 |
| 48 · `doi:10.1093/bioinformatics/btag704` | core / diagnosis | 细胞检测分类实际评估；Ki-67指数仅动机，未报告指数估计结果，quantification可能过标。 |
| 56 · `doi:10.64898/2026.06.09.26355170` | core / quantification; segmentation | 首阶段提取并骨架化气道，结构解析可能应补segmentation；输入已分割需确认是否还有自动分割。 |
| 62 · `doi:10.1002/2056-4538.70119` | core / reconstruction; segmentation; registration; quantification | 微CT组织工作流含降噪、对齐、分割和测量；是否独立计算贡献与手工操作比例未清楚，维持暂定。 |
| 64 · `doi:10.5005/jp-journals-10078-1520` | out / ∅ | 本体为临床误诊原因回顾；MRI只是多种检查之一，影像是否中心证据不充分，建议out。 |
| 69 · `arxiv:2504.06185` | core / segmentation; quantification; human_loop | 伤口尺寸估计实际评估应补quantification；医生对模型掩膜评估是否足够human_loop需统一。 |
| 71 · `doi:10.1109/trpms.2025.3613981` | core / reconstruction | 实际为PET探测器信号恢复，尚无图像重建验证；core/adjacent与reconstruction取决于仪器级信号处理纳入边界。 |
| 75 · `arxiv:2603.05911` | core / segmentation; language | 链式推理与语义提示整合分割，语言理解是否独立方向应与UniMedSeg统一。 |
| 90 · `arxiv:2603.18660` | core / language; foundation | 实际为计算病理方法综述，按聚焦方法综述约定保留core；原备注未说明review需补明。 |
| 100 · `arxiv:2607.27537` | core / reconstruction; prognosis | 预测未来MRI明确重建；是否等于prognosis需统一，因为未报告未来临床结局/疾病标签。 |
| 102 · `doi:10.1109/tuson.2026.3667582` | core / reconstruction | 像素级分辨率评价是方法贡献，但实际未生成/重建影像；reconstruction按重建质量评价口径暂留，勿当生物标志物量化。 |
| 104 · `doi:10.1097/bot.0000000000003215` | adjacent / diagnosis; prognosis | CTA隐匿血管异常检出率及后续伤口并发症关联是实际终点；是否收临床筛查/弱预后关联应统一。 |
| 141 · `arxiv:2609.16775` | core / segmentation; human_loop | 有用户涂鸦闭环与人工流程耗时比较，可能为真实交互；摘要未说明操作者及是否模拟，需核实后补HIL。 |
| 143 · `arxiv:2610.02269` | core / diagnosis | 胸片分诊蒸馏仅面向单任务，使用foundation教师不自动是基础模型贡献；建议去foundation或统一应用口径。 |
| 158 · `arxiv:2505.09274` | core / segmentation; foundation | 聚焦分割综述按暂定core；foundation/universal是实质综述对象，是否补foundation需统一综述多标签。 |
| 160 · `doi:10.1007/978-1-0716-5539-9_21` | core / reconstruction | 这是操作协议章节，非已报告实验结果的研究；可复用计算方法协议是否core需维护者确认。 |
| 161 · `doi:10.64898/2026.09.21.26362872` | core / foundation | 实际仅选帧Top-k准确率，未评估ONSD测量误差，去quantification；foundation仅作为特征器的纳入口径亦需统一。 |
| 165 · `arxiv:2603.17304` | core / diagnosis; segmentation | 模型实际使用FSL FAST分割图，按应用流水线任务补分割；若纯预处理不标需与其他论文统一。 |
| 168 · `arxiv:2603.13007` | core / reconstruction; foundation | 大规模预训练后目标迁移，与生成先验基础模型相近；作者称foundation-inspired而非通用foundation，边界需统一。 |
| 177 · `arxiv:2501.06540` | core / diagnosis; quantification | 眼底高度近视诊断及眼轴长度回归明确；ViT基础模型残差适配是否另标foundation，应与341和186等单任务适配统一。 |
| 184 · `doi:10.1177/20551169261462693` | out / ∅ | 主要为兽医罕病病例/组织学，暂out；不应仅凭无计算贡献排除所有影像病例。 |
| 186 · `arxiv:2608.09991` | core / prognosis; foundation | 实际乳腺疗效预测，foundation为冻结编码器应用；是否单任务适配也标foundation需统一。 |
| 192 · `arxiv:2604.11197` | core / language; foundation; segmentation; diagnosis | 实际交互分割应补；zero-shot recognition未逐项说明是否疾病类别，diagnosis需确认。 |
| 197 · `doi:10.21203/rs.3.rs-10728055/v1` | core / language; quantification | 既有结节的形态/直径及语言描述明确；无结节检出或良恶性分类，diagnosis可能过宽。 |
| 206 · `arxiv:2412.12660` | core / segmentation; foundation; language | LLM文本语义转视觉是实际方法，与BiCLIP同口径应补language；需统一条件分割标签。 |
| 207 · `doi:10.64898/2026.06.16.26355803` | core / segmentation; foundation; registration | 实际视频血管跟踪可能属于motion tracking，但仅描述掩膜时间一致性，registration待确认。 |
| 211 · `arxiv:2503.17543` | core / quantification; segmentation | EF量化明确；结构任务为内膜关键点而非掩膜分割，segmentation取决于结构解析是否含landmarks。 |
| 212 · `arxiv:2610.12134` | core / prognosis; language; human_loop | 明确交互纠错与重算机制且病例展示，但未说明真实临床参与者；HIL待验证。 |
| 213 · `doi:10.1016/j.jhep.2026.03.004` | adjacent / diagnosis; quantification; prognosis | 专门肝癌影像综述可adjacent，AI仅末段；临床综述/参考项与out的边界需统一。 |
| 221 · `doi:10.64898/2026.10.03.26364663` | core / segmentation | 真实专家交互训练与复核属于标注流程；现规则排除纯标注HIL，但与141等互动修正边界需统一。 |
| 224 · `arxiv:2404.07239` | core / diagnosis; quantification | 聚焦甲状腺AI/影像组学方法综述，按暂定约定core。 |
| 233 · `doi:10.1016/j.ultrasmedbio.2026.08.003` | core / human_loop; diagnosis; quantification | B线检出与非专家AI采集明确；另有严重度分数一致性，若半定量评分算quantification则补。 |
| 234 · `doi:10.64898/2026.08.17.742355` | core / segmentation; registration; quantification | 同组织空间组学的图像配准/分割/定量软件实证明确；生物显微纳入范围仍需确认。 |
| 237 · `arxiv:2503.05916` | core / segmentation; foundation | 实际微调可提示基础分割模型，与其他SAM适配是否都算foundation需统一。 |
| 238 · `doi:10.12688/f1000research.178239.1` | core / diagnosis; quantification | 聚焦CT影像组学分类综述按暂定core；结尾预后潜力不构成实际预后任务。 |
| 239 · `arxiv:2410.03086` | adjacent / ∅ | 机器人末端硬件力控与图像质量，尚无图像分析方法；保留adjacent硬件边界。 |
| 241 · `doi:10.1148/rg.250166` | adjacent / ∅ | 专门神经MR采集指导，无计算贡献；临床影像指南与out参考项边界需统一。 |
| 243 · `doi:10.34133/csbj.0082` | adjacent / diagnosis | 项目概念与模块实验，AI检测和临床试验仍将来时，未确认已做图像AI验证；建议先adjacent。 |
| 261 · `doi:10.1109/tmi.2026.3739833` | core / segmentation | 电子显微神经元分割明确；生物显微/连接组是否归医学影像需统一。 |
| 263 · `doi:10.1002/jfa2.70222` | adjacent / quantification | 明确第二研究目标是超声肌肉大小与功能关系，不能仅无算法判out；影像是否足够中心仍需确认。 |
| 264 · `doi:10.12688/f1000research.166604.2` | out / ∅ | 标准放疗剂量指数与疗效相关，影像仅CT计划背景；adjacent要求影像中心证据，建议out并清除影像预后。 |
| 270 · `arxiv:2502.16697` | core / diagnosis; quantification | 生物图显式表示血管段/无灌注区/FAZ，是否独立定量标志物需确认；明确当前DR分级非预后。 |
| 273 · `doi:10.64898/2026.08.26.26361112` | core / segmentation; quantification; reconstruction | 仅计划方案但明确自动分割、参数图和伪CT；protocol是否core需维护者统一，不把预期进展分析当已验证prognosis。 |
| 281 · `arxiv:2610.26475` | core / reconstruction | 是计算生成模型比较综述而非原创实验；按方法综述临时约定core，原备注应补review。 |
| 283 · `arxiv:2609.07188` | core / ∅ | 仅公共基准5%反馈预算，无实际医生/交互研究证据；HIL应待核，OOD检测不等于疾病检测。 |
| 302 · `doi:10.1097/rlu.0000000000006648` | out / ∅ | 主要为Lu-PSMA疗效病例，暂out；核医学图像病例与adjacent影像中心边界需统一。 |
| 304 · `arxiv:2601.15884` | core / reconstruction | 合成基准明确；摘要读者研究和下游病灶分析未说明终点，不能确定补HIL/诊断/分割。 |
| 313 · `doi:10.1109/iros60139.2025.11246546` | adjacent / intervention | 机器人OCT反馈硬件与手术操作验证，没有报告计算影像分析算法；core/adjacent待统一。 |
| 314 · `arxiv:2601.07871` | core / quantification; registration; foundation | 聚焦影像-组学计算融合方法综述，按暂定core；跨多组学定义边界需维护者确认。 |
| 317 · `doi:10.64898/2026.10.16.26365733` | core / diagnosis; quantification | MRS单体素谱的算法分类与浓度量化明确，是否纳入医学影像需确认。 |
| 318 · `doi:10.1016/j.oooo.2026.07.005` | core / diagnosis; human_loop | 聚焦人机齿科读片对照的系统综述，按方法综述约定core，HIL/诊断证据直接。 |
| 321 · `arxiv:2605.09697` | out / ∅ | 医学仅动机，未披露实验对象，暂out不能当已确认非医学。 |
| 326 · `doi:10.1021/cbmi.6c00066` | out / ∅ | 广泛化学/材料/生物成像Perspective，医学仅部分例子；跨领域综述与adjacent范围需统一，倾向out。 |
| 328 · `arxiv:2409.16183` | core / language; foundation | 摘要列出VQA/图注/报告生成与综合人评，未明确独立疾病分类/诊断准确性，diagnosis待核。 |
| 330 · `arxiv:2508.04101` | core / language; diagnosis | 肺炎数据上的任务结果很可能分类，但摘要未列终点；建议核实后加diagnosis。 |
| 331 · `doi:10.1186/s12880-026-02794-2` | core / reconstruction | 只明确2DeteCT数据集，未交代其对象是否人体/生物；不能仅CT词断言医疗，core需要核实数据领域。 |
| 332 · `doi:10.1109/tuson.2026.3666270` | adjacent / ∅ | 换能器制造和仿体分辨率，adjacent采集硬件口径。 |
| 334 · `doi:10.24963/ijcai.2024/610` | out / ∅ | 临床仅例子，四个实验数据未说明；暂out而非确定无医学评估。 |
| 340 · `doi:10.3389/fonc.2026.1751817` | adjacent / quantification | 描述治疗中/后参数变化与已知响应分组，没有先验预测终点；若prognosis限定疗效预测则删除。 |
| 341 · `arxiv:2508.21041` | core / diagnosis; foundation | 病理异常有丝分裂分类明确；自然预训练骨干单任务微调是否foundation需与143/177统一。 |
| 343 · `arxiv:2410.14083` | core / registration; foundation; segmentation | 基于SAM分割ROI进行配准，分割是实际组成；是否只标主要终点需统一。 |
| 347 · `doi:10.21203/rs.3.rs-10975699/v1` | adjacent / ∅ | 影像CAC发现后的临床管理综述，保留adjacent但与治理/路径out边界需统一。 |
| 351 · `arxiv:2602.06761` | core / registration; quantification | 注册自监督和ED/ES时相定位明确；quantification是否含时相帧定位应与选帧论文161统一。 |
| 354 · `arxiv:2606.05113` | core / reconstruction; prognosis; quantification; segmentation | 实际评估组织分割和海马体积预测，应补两track；prognosis仅未来图像生成边界仍待统一。 |
| 360 · `arxiv:2608.24626` | core / reconstruction; quantification | 虚拟染色任务基于CPA胶原量化，task-specific error可能为CPA但摘要未直接对应，需核。 |
| 380 · `doi:10.20944/preprints202609.0266.v1` | out / ∅ | 横跨文本、临床信号、代理和生物声学的医学大模型综述；影像是若干领域之一，按广泛跨领域约定倾向out，需维护者定界。 |
| 381 · `doi:10.20944/preprints202608.1013.v1` | core / diagnosis; quantification; foundation | 心衰多模态AI综述聚焦具体诊断并讨论影像测量，按方法综述口径core；非影像ECG/EHR占比需与380统一定界。 |
| 390 · `arxiv:2601.16753` | core / language | 只处理报告文本，但为影像报告生成模型评价方法；严格图像输入要求会out，评估链纳入口径会core。 |
| 391 · `doi:10.3174/ajnr.a9296` | core / diagnosis; quantification | BRAF为分子状态分类，明确非未来预后；是否同时计diagnosis和quantification需统一与IDH1等分子分类。 |
| 392 · `doi:10.1117/12.3085625` | core / diagnosis; language; foundation | 系统比较基础VLM适配策略，按同类foundation评估可补；若应用不计则保留原。 |
| 394 · `doi:10.1111/dmcn.70460` | core / reconstruction; registration; segmentation; quantification | 聚焦胎儿MRI计算流水线叙述综述，按暂定方法综述规则core。 |
| 396 · `doi:10.64898/2026.09.20.26363529` | core / diagnosis; quantification | 手工影像特征及腺体大小/纹理审计可能属影像组学，但未明确独立标志物输出，量化待统一。 |
| 398 · `doi:10.1007/s13193-026-02534-6` | adjacent / intervention; quantification | 明确心脏位移/ITV测量但主要是剂量规划比较，是否另计定量影像需统一。 |

## 31 条缺摘要的完整清单

这些条目均为 `title_only`，包括看似明确的算法题名也未解除未核实状态。仅凭“像书名”的题名不足以最终判定出版类型；相似的临床影像题名目前可能分别为out或adjacent，须补证据后处理。

| 序号 / ID | 暂定建议 | 题名证据与限制 |
| --- | --- | --- |
| 27 · `epmc:PMC:PMC1341814` | adjacent / diagnosis | 仅题名支持超声筛查；无摘要不能确认类型或计算贡献。 |
| 31 · `epmc:PMC:PMC12493938` | adjacent / intervention | 题名支持MRI放疗规划；未说明自动勾画，不能凭delineation加分割。 |
| 42 · `doi:10.2214/ajr.26.35721` | out / ∅ | 题名为回复评论暂out；无摘要无法排除新增实证。 |
| 54 · `epmc:PMC:PMC13660074` | core / diagnosis; quantification | 题名明确影像组学和神经病变检测，但无摘要不能核验方法/验证。 |
| 55 · `epmc:PMC:PMC13673992` | core / foundation | 题名明确眼底基础模型迁移，未披露下游任务。 |
| 65 · `epmc:PMC:PMC13597306` | core / reconstruction | 题名支持深度超分辨，但无摘要无法核验。 |
| 73 · `epmc:PMC:PMC13674572` | core / segmentation | 题名为视网膜病灶分割；形态重建是算子，不据此加影像重建。 |
| 74 · `epmc:PMC:PMC1488488` | out / ∅ | 招募筛查受试者并不直接分析影像；题名暂out。 |
| 77 · `epmc:PMC:PMC1546679` | out / ∅ | 宫高为体格测量，非影像；无摘要。 |
| 82 · `epmc:PMC:PMC12493913` | out / ∅ | 共识定义/Delphi属于参考规范项，按out定义建议out；缺摘要，待确认是否另有影像实证。 |
| 98 · `doi:10.1136/jcp.27.2.172-a` | out / ∅ | 题名像临床影像书评或参考书；缺摘要暂out。 |
| 101 · `epmc:PMC:PMC1260334` | out / ∅ | 仅题名无法断言是参考书或实证影像形态研究；out只可暂定。 |
| 108 · `epmc:PMC:PMC1650382` | out / ∅ | 历史治疗影像手册暂out；无摘要。 |
| 115 · `epmc:PMC:PMC12493369` | adjacent / quantification; prognosis | 题名明确PET/MRI定量指标预后分层，但无摘要无法确认计算方法。 |
| 123 · `epmc:PMC:PMC491715` | out / ∅ | 题名本身不能区分书评和临床研究；out仅暂定，不能以无计算方法排除adjacent。 |
| 126 · `doi:10.1002/ase.70357` | out / ∅ | Re:提示通信，暂无原始评估证据。 |
| 150 · `epmc:PMC:PMC13575548` | core / human_loop; language | 题名明确AI工作流与报告生成，缺摘要无法确定分诊疾病终点。 |
| 155 · `doi:10.1177/014107688407701132` | out / ∅ | 题名明确参考卷册，暂out。 |
| 172 · `epmc:PMC:PMC1214808` | out / ∅ | 仅题名像临床参考书，无法独立确定文献类型；暂out待核。 |
| 188 · `epmc:PMC:PMC13580684` | core / registration | 题名支持MRI运动校正，缺摘要不能区分信号导航与图像配准。 |
| 193 · `epmc:PMC:PMC496574` | adjacent / diagnosis | 无摘要、题名可为参考书或临床研究；与123/172的out不能单靠相似题名保持一致性。 |
| 231 · `doi:10.1177/003591577707000334` | out / ∅ | 参考性题名，无摘要不能最终确认出版类型。 |
| 248 · `doi:10.1016/j.media.2026.104327` | core / foundation | 题名明确病理基础模型采样方法，缺摘要保留暂定。 |
| 275 · `doi:10.1109/tmi.2026.3741804` | core / segmentation | 题名明确肺段分割方法，无摘要。 |
| 284 · `epmc:PMC:PMC1416436` | adjacent / diagnosis | 题名比较两种成像诊断，暂无摘要核验。 |
| 293 · `doi:10.1136/jcp.44.4.352-c` | out / ∅ | 眼组织病理参考指南题名，缺摘要暂out。 |
| 305 · `doi:10.1136/bmj.307.6909.940-b` | out / ∅ | 泛组织病理诊断题名，无摘要，暂out需出版类型核验。 |
| 323 · `epmc:PMC:PMC13658689` | core / segmentation; foundation | 题名明确SAM3医学病灶适配，无摘要。 |
| 337 · `doi:10.1136/bmj.300.6718.194` | adjacent / diagnosis | 题名为卵巢癌超声筛查，缺摘要无法判断评论或实证。 |
| 368 · `epmc:PMC:PMC12493889` | core / segmentation | 题名明确自动脑转移分割算法挑战，无摘要。 |
| 385 · `epmc:PMC:PMC13617412` | core / diagnosis; foundation | 题名明确基础模型嵌入的肺癌亚型分类，无摘要。 |

## 校验与人工门禁

已校验400个ID唯一且与冻结证据完全相同，逐条原值与CSV/annotations相同，所有短引文都能在冻结题名或摘要找到，建议值仅使用既定scope与10个track。校验只确认文件完整性与可追溯性，不证明语义判断正确。

本轮未创建 `relevance-gold.csv`，未写入 `maintainer-reviewed` 标记，也未声称满足P4准确率目标。人工门禁按 `eval/README.md` 保持待确认：维护者先裁定边界，再审查全部400条及31条缺摘要，才能决定是否正式提升为人工金标准。
