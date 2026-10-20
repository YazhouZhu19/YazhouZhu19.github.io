# AI 二审建议的保守整合

> **PROVISIONAL — 仍待维护者复核，不是人工金标准。** “接受”仅表示本轮 AI 根据冻结摘要接受该项修订，不代表已由人确认。原始标注、原始 CSV 与冻结证据均未修改。

- 对 67 条 `change_suggested` 逐一读取完整冻结标题与摘要：**42 条接受、9 条部分接受、16 条暂缓**。
- 新版共保留 400 条；其中 **51 条标签发生修改**（scope 3 条、track 50 条；两者可重叠）。
- 217 条 AI 一致项、85 条边界项和 31 条缺摘要项的标签原样保留。85 条边界项仍未确认；31 条仍仅有标题证据，不能视为已验证。
- 保留实际报告的下游任务；辅助预处理、基础模型复用、分子分型映射和仅有读片评估的人机标签继续待裁定。明确的真实用户交互实验与普通标注/模拟点击分开判断。
- 本轮并非盲审；已同时看到原标注与二审建议。未检索全文或新增证据，不报告人为一致率或总体准确率。

## 输出与审计

- [AI 整合版 CSV](relevance-ai-reviewed.csv) · [逐条标注及未确认状态](relevance-ai-reviewed-annotations.json)
- [逐项整合 JSON](reconciliation.json) · [诊断报告](report-ai-reviewed.md)
- [原版 CSV](relevance-sample.csv) · [原版标注](relevance-annotations.json) · [冻结完整摘要证据](relevance-evidence.json)
- [独立 AI 二审](second-review.md) · [二审 JSON](second-review.json)
- 完整冻结证据 SHA-256：`12f32a22fa27f29f582a6f8c2b6f7556c7490cec030e80d0431c2037bee7e124`。输入文件逐一校验值记录在 JSON，便于确认原始审计链未改。

## 67 项处理记录

完整原值、二审建议、修订值和待裁定边界均在 JSON；下表保留逐条处理与依据。

| 样本序号 / ID | 处理 | 修订标签 | 理由 |
|---|---|---|---|
| 5 · `arxiv:2606.00602` | 接受 | core / foundation; language; diagnosis; segmentation; prognosis | 完整摘要明确列出22项下游任务，并报告跨任务实验，其中包括异常分类、分割和疾病预后预测；三项补标均对应实际评估，而不是背景示例。 |
| 19 · `arxiv:2608.16233` | 部分接受 | core / reconstruction; diagnosis | 独立200例诊断评估报告临床显著癌症AUC，支持补充diagnosis。1000例读片主要评价重建图像质量；读片实验是否足以构成human_loop仍属待定边界，暂不增补。 |
| 34 · `doi:10.64898/2026.08.13.26360270` | 部分接受 | core / intervention; segmentation | 提出的电极定位方法明确以概率分割电极结构作为算法组成，支持segmentation。7条电极通过扩展工具人工修正属交互线索，但是否满足临床human_loop研究口径尚未统一，保留原human_loop缺省。 |
| 35 · `arxiv:2607.03593` | 暂缓 | core / diagnosis; quantification | 摘要将已有稳健分割模型用于先行勾画，主要贡献和验证是签名提取、分类与影像组学；没有独立分割性能终点。辅助预处理是否单独计入方向尚待裁定，保留原标签。 |
| 51 · `doi:10.64898/2026.09.10.26362169` | 暂缓 | core / registration; quantification | RIFE插值和TotalSegmentator分割是六阶段流水线的既有工具，报告的系统实验集中于配准配置和增强图阈值。是否将辅助插值/分割分别记为reconstruction/segmentation尚未统一，保留原标签。 |
| 61 · `arxiv:2601.15891` | 接受 | core / foundation; language; diagnosis; segmentation | 摘要明确说明除报告生成外还实施分类与分割迁移实验；补充diagnosis和segmentation有实际评估依据。 |
| 66 · `doi:10.1007/s10278-026-02241-2` | 接受 | core / reconstruction; segmentation | 完整摘要报告下游解剖分割的Dice对照结果，不仅是PHI文本区域检测或一般用途描述，支持补充segmentation。 |
| 67 · `doi:10.21037/cdt-2025-1-653` | 暂缓 | core / diagnosis; quantification; prognosis | U-Net冠脉分割被描述为影像组学之前的处理步骤；结果仅给出斑块/风险模型的分类与预后指标，未单独评价分割。辅助分割标注口径待定，保留原值。 |
| 68 · `doi:10.64898/2026.07.16.26356882` | 接受 | core / human_loop; diagnosis | 前瞻性研究明确以近端DVT敏感性、特异性及分诊表现为终点，并给出结果，符合既定诊断准确性评估口径，补充diagnosis。 |
| 70 · `doi:10.1148/ryct.250521` | 暂缓 | core / reconstruction; registration; diagnosis | 原始CT与加入合成CT后的医生检测AUC对照是明确读片实验，但reader study是否直接纳入human_loop仍未统一；保留已有重建、配准和诊断标签。 |
| 79 · `arxiv:2509.23097` | 接受 | core / foundation; diagnosis | 病理模型在六项临床任务上评估，并明确报告诊断准确率与跨机构验证；diagnosis不是仅据背景中的临床部署措辞推断。 |
| 80 · `doi:10.1007/978-3-032-06329-8_3` | 接受 | core / reconstruction | 实际实验是从脑MRI生成超声图像；术中引导与配准仅作为动机或后续用途，未报告导航/治疗实验。删除intervention并保留reconstruction。 |
| 84 · `arxiv:2512.03449` | 接受 | core / segmentation; quantification; diagnosis | 摘要明确进行OA与非OA分类，并报告两个队列的AUC；支持在分割、定量基础上补充diagnosis。 |
| 88 · `doi:10.64898/2026.06.25.26356440` | 暂缓 | core / reconstruction; human_loop | 该实验评价专家识别合成/真实影像的能力，不评价临床诊断辅助。是否将这类人机评估排除出human_loop属于尚未确认的标签边界，本轮保留原值并标记，避免单方面改变定义。 |
| 94 · `arxiv:2610.24044` | 部分接受 | core / reconstruction; segmentation; prognosis | 摘要明确列出并评价肿瘤分割，且将总生存预测列为下游实验，支持补充segmentation和prognosis。IDH1分子状态分类是否映射为quantification而非diagnosis尚未统一，暂不增补quantification。 |
| 111 · `doi:10.18502/jthc.v20i2.19711` | 接受 | adjacent / 无 track | 超声心动图发现心包异常，CT显示造影剂外渗并确认破裂部位；多模态影像是病例诊断和病因刻画的核心证据，符合adjacent，不能仅因没有算法而判out。 |
| 125 · `arxiv:2506.10633` | 接受 | core / language; diagnosis | 实际工作是改善报告文本与胸片区域对齐，并评估短语定位和疾病分类；扩散模型只是骨干，摘要没有图像合成质量实验。改为language、diagnosis并移除reconstruction。 |
| 133 · `doi:10.1016/j.jdent.2026.107087` | 暂缓 | core / segmentation; registration; intervention | 三名医生确实比较常规与模型辅助种植规划，并报告定位一致性；但辅助决策/读片实验纳入human_loop的统一阈值尚未确定，暂保留原值而不把该具体建议视为已确认。 |
| 137 · `doi:10.53045/jprs.2025-0100` | 接受 | adjacent / quantification | 五年CT及三维软件测得皮瓣体积变化，并把体积与体重的相关性作为主要发现。影像定量是核心证据，支持adjacent与quantification；单病例且未提出计算算法，不升级core。 |
| 148 · `arxiv:2508.20734` | 接受 | core / registration; segmentation; quantification | 提出的贝叶斯网络包含双心室分割与运动估计两个后验模型，且验证了临床指标提取准确性；两项均属方法和评估内容，支持segmentation、quantification。 |
| 151 · `arxiv:2511.19667` | 部分接受 | core / diagnosis; segmentation; quantification | 明确从预测掩膜提取形状、强度、纹理影像组学特征并纳入融合策略，支持quantification。六名医生辅助评估的human_loop归属仍待统一；输出十个结构化临床特征/模板报告不足以确定language任务，暂缓这两项。 |
| 154 · `doi:10.1007/s10278-026-02329-9` | 暂缓 | core / diagnosis | 摘要明确报告AI辅助前后读片AUC，但将辅助读片一律视为human_loop属于尚未确认的范围规则，保留diagnosis及原human_loop缺省。 |
| 156 · `arxiv:2606.05628` | 接受 | out / 无 track | 可用摘要的贡献是声学全息透镜优化、无需影像的对准和非线性声学监测；MRI仅为被替代的依赖，未报告医学影像输入或分析实验。按现有核心定义改out并清除intervention，不推断未提供的全文内容。 |
| 159 · `arxiv:2606.04792` | 部分接受 | core / diagnosis; foundation; human_loop; prognosis | 28项临床任务中明确包含并评价预后预测，支持prognosis；分子分型AUC本身不足以确定其应归quantification，暂缓此映射。原human_loop不改，但摘要已报告随机交叉读片的准确率和时间结果，原备注中的仅有动机描述需澄清。 |
| 162 · `arxiv:2504.15928` | 暂缓 | core / diagnosis; foundation | 31名眼科医生参加前瞻性可用性评价，是明确人参与线索；但摘要未详述交互环节与终点，且可用性研究纳入human_loop的阈值仍待裁定，暂不补标。 |
| 166 · `arxiv:2508.12226` | 接受 | core / reconstruction; quantification | 方法的明确输出是组织声学参数的三维空间图，并在模拟与体内数据上评价定量超声成像，支持quantification而不只是一般重建质量指标。 |
| 175 · `arxiv:2511.02086` | 接受 | core / registration; intervention; human_loop | 摘要明确描述术中人工引导初始化与后续配准组成的交互流程，且在七次真实术中试验验证；不是单纯专家标注、模拟点击或质量读片，支持human_loop这一具体临床交互任务。 |
| 187 · `doi:10.5624/isd.20260079` | 暂缓 | core / quantification | 虽然训练了U-Net并处理7832张影像，独立报告的验证终点均为年龄估计，分割处于前处理角色。将自训辅助分割是否也算独立方向仍需统一，保留quantification。 |
| 190 · `doi:10.1016/j.media.2026.104335` | 接受 | core / registration; reconstruction; segmentation | 摘要将下游分割作为跨模拟和体内扫描的实际改进结果，与仅列举潜在用途不同，支持补充segmentation。 |
| 202 · `doi:10.1007/s00259-026-08190-w` | 接受 | adjacent / quantification; diagnosis | 除SUV与MRI评分关联外，实际报告AS对DJD及非放射学axSpA的鉴别AUC，符合已定义的影像诊断准确性评估，补充diagnosis。 |
| 208 · `doi:10.1148/rycan.250617` | 接受 | core / prognosis; quantification; language | DLRTransformer明确融合CT影像组学和LLM提取的病理报告嵌入，属于定量影像与图文多模态输入的实际方法组成；支持quantification、language，且不误称使用病理图像。 |
| 209 · `arxiv:2509.12090` | 接受 | core / registration; reconstruction; intervention | 方法明确定义术前建模与术中稀疏切片实时更新，并在私有介入数据及术中设置实际验证，intervention不只是引言中的用途，接受补标。 |
| 215 · `arxiv:2510.15042` | 接受 | core / language; foundation; segmentation; diagnosis | 摘要报告语义分割、分类探测和零样本分类的实际性能，支持segmentation与diagnosis；保留既有language、foundation。 |
| 218 · `doi:10.64898/2026.07.30.26359276` | 接受 | core / registration; quantification; segmentation | U-Net分割是被直接比较的五种筋膜追踪算法之一，并给出其误差及功能量结果；它本身是评估对象，支持segmentation而非仅辅助预处理。 |
| 222 · `arxiv:2603.21597` | 暂缓 | core / diagnosis; prognosis; language | 交互仪表盘和会话界面是人机研究线索，且医生读片受益有结果；但摘要没有明确医生实验中交互环节的使用方式，辅助读片与交互流程的human_loop界线仍待统一，本轮保留原值。 |
| 229 · `arxiv:2503.00972` | 暂缓 | core / registration; intervention | AI分割提供语义标签，实验评价的是配准流水线及对齐误差，未独立评价分割。辅助标签生成是否计segmentation方向仍待确认，保留原标签。 |
| 235 · `doi:10.1016/j.amjcard.2026.09.014` | 接受 | adjacent / intervention | 研究比较两种影像引导PCI的两年结局，未用影像特征预测个体结局或验证预后标志物；随访结局比较本身不等于预后预测任务，删除prognosis。 |
| 236 · `arxiv:2604.22700` | 部分接受 | core / reconstruction; prognosis; foundation; diagnosis; segmentation | 完整摘要明确在下游纵向疾病分类与脑分割上验证，支持两项补标。虽然没有描述通用预训练，foundation去留涉及尚未统一的基础模型范围，暂保留原值；未来影像生成是否算prognosis也继续待裁定。 |
| 240 · `arxiv:2602.19213` | 暂缓 | core / segmentation | 确实复用并适配SAM，但是否把任何SAM适配研究都标为foundation，还是要求基础模型本身的训练/系统研究，尚未形成口径，暂不新增foundation。 |
| 244 · `arxiv:2501.12632` | 接受 | core / diagnosis; language | 核心方法将CLIP文本嵌入与局部图像块对比对齐，并在病理定位基准验证，属于实际图文建模而非仅提到预训练骨干，补充language。 |
| 254 · `arxiv:2505.11909` | 暂缓 | core / segmentation | 生成源风格目标图像确为分割方法组成，但摘要的性能与消融围绕跨模态分割，未报告独立重建/合成终点。将为分割服务的风格生成计入reconstruction仍属辅助步骤边界，暂保留原值。 |
| 259 · `doi:10.1002/jfa2.70226` | 接受 | adjacent / prognosis; quantification | 负重X线HVA角度是研究的实际定量影像指标，并据此分层及关联术后功能，支持quantification；手工测量不使scope升级为core。 |
| 262 · `arxiv:2510.23224` | 部分接受 | core / language; diagnosis | 八项评估含恶性判断、淋巴结转移检测及肿瘤分型，支持diagnosis。多中心辅助读片虽然有准确率结果，human_loop阈值仍待统一，暂不补标；不把未明时间性的HCC风险直接当预后。 |
| 267 · `doi:10.64898/2026.08.03.26359612` | 接受 | core / registration; intervention; quantification | 方法针对肝消融前后CT的术中最小消融边界评价，MAM是明确验证指标；支持intervention及quantification，不只是一般配准的潜在临床用途。 |
| 269 · `arxiv:2610.18926` | 部分接受 | core / registration; intervention; language | CAP-DIR明确将临床文本与CT、轮廓、剂量及历史形变共同作为输入，支持图文多模态language。盲法评价轮廓可接受性并估计编辑时间，尚不足以统一判定实际human_loop流程，暂缓该项。 |
| 271 · `arxiv:2507.00673` | 接受 | core / segmentation | 明确的双输入是胸片与涂鸦图像提示，全文摘要没有文本语言编码或生成模块；prompt一词不代表语言任务，移除language并保留segmentation。 |
| 274 · `arxiv:2511.09394` | 暂缓 | core / diagnosis; language | 系统可解释用户请求且有医生辅助后的诊断/报告获益，但摘要未明确人机评估中交互反馈环节，读片辅助与human_loop的统一边界仍待裁定，保留原值。 |
| 288 · `doi:10.64898/2026.06.16.26355800` | 接受 | core / quantification; prognosis; segmentation; diagnosis | 多任务U-Net明确执行BAC检出与分割，并分别报告AUROC和Dice，属于实际训练和独立验证的任务，接受diagnosis、segmentation补标。 |
| 291 · `arxiv:2610.06094` | 接受 | core / reconstruction | 研究实际验证CBCT改良的图像质量、线剖面及ROI指标；计划CT作为参照，未评价计划、剂量或治疗引导任务。影像引导放疗仅为应用动机，移除intervention。 |
| 292 · `arxiv:2512.17080` | 接受 | core / reconstruction; diagnosis | 合成数据效用方法在内镜、皮肤镜、眼底等医疗影像分类任务实际验证，并报告分类性能提升，支持diagnosis而不是只据临床决策支持背景补标。 |
| 299 · `doi:10.1109/tuson.2026.3687801` | 接受 | core / reconstruction; quantification | 随机反演明确重建声速这一组织物理参数，并用模拟与患者数据比较，支持定量参数成像quantification，与一般图像质量评分不同。 |
| 301 · `arxiv:2604.23481` | 接受 | core / diagnosis; segmentation | 摘要明确在未见组织上同时评价细胞核分割和分类性能，支持segmentation；不是仅以核掩膜作为未经评估的输入。 |
| 312 · `doi:10.1109/tuson.2026.3683326` | 暂缓 | core / reconstruction | 运动校正是GPU实时成像的处理步骤之一，报告验证集中于整体处理速度和图像质量，未说明独立配准方法或精度。辅助运动校正是否记registration待裁定，保留原标签。 |
| 315 · `doi:10.1227/neuprac.0000000000000216` | 接受 | adjacent / quantification | 实际结果是视神经鞘直径、Meckel腔体积及其他MRI标志的出现率；用于诊断标准明确留待后续研究，没有诊断准确性评估。移除diagnosis、增加quantification，scope维持adjacent。 |
| 319 · `arxiv:2607.20037` | 暂缓 | core / reconstruction | 形变配准用于构建匹配数据并做视觉质控，数据集与挑战的研究目标是重建/影像校正，未提供独立配准基准或性能结果。数据准备中的配准是否单列track未定，暂保留reconstruction。 |
| 324 · `arxiv:2607.19099` | 接受 | core / reconstruction; quantification | 工具箱实际实现并在模体及体内验证T1、R2*、B0参数图，quantification是明确输出和验证对象，接受补标。 |
| 338 · `arxiv:2605.02720` | 接受 | core / language; foundation; diagnosis | 采用相同CLIP模型比较训练来源，并在110项临床任务报告线性探测分类AUROC，支持diagnosis，保留原图文和基础模型标签。 |
| 342 · `arxiv:2608.00831` | 接受 | core / registration; intervention; foundation; reconstruction | 框架实际合成治疗日预测CT，并比较CT值误差与解剖相似性；预测影像是研究输出而非仅背景用途，支持reconstruction，不由此新增临床prognosis。 |
| 348 · `arxiv:2605.16980` | 部分接受 | core / segmentation; quantification; reconstruction | Pix2Pix去除石膏/背景伪影是明确处理阶段且报告留出集Dice、IoU，并构建闭合表面模型，支持重建/增强。GBCPD++配准主要用于PCA前建立对应，缺少独立配准评价；辅助配准track口径未定，暂不增加registration。 |
| 357 · `arxiv:2607.22332` | 接受 | core / segmentation; human_loop | 不止使用专家标注或模拟点击：明确实施六名真实专家、三项临床标注任务的前瞻性对照用户研究，比较交互式模型、手工流程与可用性，支持human_loop。 |
| 361 · `doi:10.3390/diagnostics16152385` | 接受 | core / reconstruction; segmentation | 合成增强后nnU-Net的Dice及统计检验是明确下游实验，支持segmentation，而背景中的分类和图文用途不额外补标。 |
| 362 · `doi:10.64898/2026.08.27.26361537` | 接受 | core / quantification; diagnosis | CTA-CFD模型除压力梯度定量外，还对血流动力学显著狭窄报告敏感性和特异性，符合诊断准确性评估口径，补充diagnosis。 |
| 364 · `arxiv:2606.18887` | 接受 | core / registration; reconstruction | 方法除配准误差外，实际生成离体心脏ULM超分辨影像并报告219微米空间分辨率；重建/超分辨成像是已演示输出，接受reconstruction。 |
| 367 · `arxiv:2609.28081` | 接受 | core / registration; quantification | 不仅给出形变/MSE结果，摘要还明确验证射血分数估计相对于真值的误差改善，支持quantification。 |
| 371 · `doi:10.64898/2026.08.03.26359608` | 接受 | core / diagnosis | LLM代理承担已有乳腺影像软件的重建、优化和修改，摘要未描述图文理解、文本报告输入或生成任务；不把使用LLM开发工具等同language方向，保留diagnosis。 |
| 395 · `doi:10.3390/s26154817` | 接受 | core / segmentation | 实现的是六个有界软件代理和确定性监测叠加，未报告语言模型或图文语言处理；agentic命名不足以支持language，移除该标签并保留真实CT分割实验对应segmentation。 |
| 397 · `doi:10.1007/s00234-026-04135-0` | 接受 | core / diagnosis; human_loop; quantification | 明确开发并验证手工影像组学和深度影像组学基模型，再与其他特征堆叠融合，quantification有具体方法依据；原diagnosis及human_loop不在本条修改范围。 |

## 报告口径

评测脚本仅替换标注输入，仍使用相同 400 条完整冻结证据与同一分类器。新版报告包括未确认的边界及缺摘要记录，因此只用于回归诊断，不能宣称 P4 达标。人工确认门禁保持原状，不创建 `relevance-gold.csv`。

```sh
npx tsx scripts/eval-classifier.ts --labels eval/relevance-ai-reviewed.csv --output eval/report-ai-reviewed.md
```
