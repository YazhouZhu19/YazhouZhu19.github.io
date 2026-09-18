# 感兴趣方向 / Research interests

平台按下列 10 个方向组织医学影像研究。保留原有两个方向，并增加从图像形成、分析到临床应用及通用模型的研究主题。这是为本平台设计的导航体系，并非学会或会议发布的官方十类标准。

The dashboard uses these 10 research interests to organize medical imaging literature. They extend the original two interests across image formation, analysis, clinical applications, and reusable models. This is a dashboard-specific grouping, not an official ten-category taxonomy.

| ID | 中文 | English | 范围示例 / Examples |
| --- | --- | --- | --- |
| `segmentation` | 器官与病灶分割 | Organ and lesion segmentation | 器官、肿瘤及病灶轮廓 / Organ, tumor, and lesion delineation |
| `human_loop` | 人在回路临床诊断 | Human-in-the-loop clinical diagnosis | 交互修正、读片者评估、人机协作 / Interactive correction, reader studies, human–AI collaboration |
| `diagnosis` | 病灶检测与疾病分类 | Lesion detection and disease classification | 病灶定位、筛查、影像辅助诊断 / Lesion localization, screening, image-based diagnosis |
| `reconstruction` | 影像重建、增强与合成 | Image reconstruction, enhancement, and synthesis | 加速重建、去噪、超分辨率、跨模态合成 / Accelerated reconstruction, denoising, super-resolution, cross-modal synthesis |
| `registration` | 影像配准与运动跟踪 | Image registration and motion tracking | 刚性或形变配准、影像对齐、运动估计 / Rigid or deformable registration, image alignment, motion estimation |
| `quantification` | 影像组学与定量标志物 | Radiomics and quantitative biomarkers | 影像组学、形态测量、定量影像标志物 / Radiomics, morphometry, quantitative imaging biomarkers |
| `prognosis` | 预后与疗效预测 | Prognosis and treatment-response prediction | 生存、疾病进展、治疗反应预测 / Survival, disease progression, treatment-response prediction |
| `language` | 影像语言与多模态理解 | Image–language and multimodal understanding | 影像报告、视觉问答、图文检索 / Imaging reports, visual question answering, image–text retrieval |
| `intervention` | 治疗规划与影像导航 | Treatment planning and image-guided intervention | 放疗规划、手术导航、术中影像 / Radiotherapy planning, surgical navigation, intraoperative imaging |
| `foundation` | 医学影像基础模型 | Medical imaging foundation models | 医学影像通用模型、MedSAM 等模型的开发或应用 / Reusable imaging models and development or application of models such as MedSAM |

## 设计依据 / Design basis

主要任务范围参考 [MICCAI 2026 征稿主题](https://miccai.org/2025/12/04/miccai-2026-call-for-papers/)与 [MIDL 2026 学术范围](https://2026.midl.io/aims-and-scope)。保留“人在回路”作为独立方向，以支持团队原有兴趣。基础模型作为方法类方向，可与其他任务同时出现；例如 [MedSAM 原始论文](https://www.nature.com/articles/s41467-024-44824-z)研究医学影像分割基础模型。

The task coverage draws on the [MICCAI 2026 topics](https://miccai.org/2025/12/04/miccai-2026-call-for-papers/) and [MIDL 2026 scope](https://2026.midl.io/aims-and-scope). Human-in-the-loop research remains a separate interest to support the team's existing focus. Foundation models form a method-oriented interest that can overlap with task-oriented interests; the original [MedSAM paper](https://www.nature.com/articles/s41467-024-44824-z), for example, studies a foundation model for medical image segmentation.

## 如何理解标签 / Reading the labels

- 标题与摘要通过可检查的关键词规则分类，不调用 LLM。标签是待阅读的相关性线索，不表示论文质量、临床有效性或证据等级。
- 同一篇论文可以属于多个方向。各方向数量不能直接相加作为论文总数；“全部”按论文记录去重统计。
- “人在回路”可包括交互方法或读片研究线索。仅有专家标注或模拟点击不能证明真实临床人员参与验证。
- 查询限额、来源收录范围、摘要缺失与措辞差异都会造成漏检或误分。新方向扩展后的数量增长也可能来自采集范围变化，不应全部解释为科研热度上升。

- Inspectable title/abstract keyword rules assign labels without calling an LLM. Labels identify reading candidates, not research quality, clinical validity, or evidence strength.
- A paper can have multiple interests. Do not add interest counts to obtain the total; “All” counts distinct stored paper records.
- Human-in-the-loop signals may describe interactive methods or reader studies. Expert annotation or simulated clicks alone do not establish validation with clinical users.
- Query caps, source coverage, missing abstracts, and wording can cause missed or incorrect labels. Growth after the scope expansion may reflect new collection coverage rather than a rise in research activity.

Source bounds and collection behavior are documented in [COLLECTOR.md](COLLECTOR.md).
