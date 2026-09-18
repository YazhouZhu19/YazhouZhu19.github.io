import type { Paper } from "./types";
export const TASKS: Record<string,string> = {segmentation:"分割与结构解析",diagnosis:"检测与辅助诊断",reconstruction:"重建、增强与生成",registration:"配准与运动跟踪",quantification:"定量影像与标志物",prognosis:"预后与疗效预测",language:"影像与语言理解",intervention:"治疗规划与导航",general:"跨任务研究"};
/** Stable identifiers are shared by saved filters, the UI and source query provenance. */
export const INTEREST_TAXONOMY_VERSION = "2026-09-18-ten-interests-v1";
export const TRACKS: Record<string,string> = {
 segmentation:"器官与病灶分割", human_loop:"人在回路临床诊断", diagnosis:"病灶检测与疾病分类",
 reconstruction:"影像重建、增强与合成", registration:"影像配准与运动跟踪", quantification:"影像组学与定量标志物",
 prognosis:"预后与疗效预测", language:"影像语言与多模态理解", intervention:"治疗规划与影像导航", foundation:"医学影像基础模型",
};
export const TRACK_DESCRIPTIONS: Record<string,string> = {
 segmentation:"器官、肿瘤与病灶的自动或交互式分割及轮廓勾画。",
 human_loop:"医生与 AI 协同诊断、读片者研究、交互修正及专家反馈；专家标注或模拟交互本身不计入。",
 diagnosis:"医学影像中的病灶检测、疾病分类、筛查及辅助诊断。",
 reconstruction:"医学影像重建、去噪、超分辨率、伪影校正及跨模态合成。",
 registration:"医学影像配准、跨模态对齐及解剖结构的运动估计与跟踪。",
 quantification:"影像组学、定量测量、形态分析及影像生物标志物。",
 prognosis:"基于医学影像的生存、疾病进展、治疗响应与临床结局预测。",
 language:"医学影像报告生成、视觉问答、图文检索及视觉语言理解。",
 intervention:"放疗规划、剂量预测、手术导航、影像引导干预及术中分析。",
 foundation:"面向医学影像的基础模型、通用分割模型及大规模视觉预训练模型。",
};
export const HUMAN_LABELS:Record<string,string>={interactive:"交互分割 / 修正",reader:"读片者评估线索",assisted:"AI辅助诊断线索",feedback:"人类反馈 / 在回路",simulated:"含模拟交互",annotation:"专家标注 / 参考标准"};
const patterns:Record<string,Record<string,RegExp>>={
tasks:{
 segmentation:/\bsegment(?:ation|ing|ed)?\b|delineat|contouring/i,
 diagnosis:/\bdiagnos|(?:lesion|nodule|polyp|tumou?r|disease|cancer) (?:detect|classif)|(?:detect|classif)(?:ion|ication|ying)? of (?:lesion|nodule|polyp|tumou?r|disease|cancer)|screening|computer.aided detect/i,
 reconstruction:/(?:image|imaging|tomographic|mri|ct|pet|ultrasound) reconstruct|reconstruct(?:ion|ing) (?:of )?(?:medical |mr |ct |pet )?imag|super.resolution|denois|(?:image|imaging|mri|ct) synthes|synthe(?:tic|sis of).{0,20}(?:image|mri|ct)|cross.modal.{0,30}(?:generat|translat)|artifact (?:reduc|correct)/i,
 registration:/(?:image|imaging|deformable|rigid|multimodal|cross.modal|medical) registration|registration of.{0,25}imag|deformable.{0,20}align|motion (?:estimat|track|correct)|image alignment/i,
 quantification:/radiomic|imaging biomarker|(?:image|mri|ct|pet).derived biomarker|quantitative (?:imag|mri|ct|ultrasound)|morphometr|volumetr|texture analys/i,
 prognosis:/prognos|survival (?:predict|analys|model)|(?:predict|forecast).{0,35}(?:survival|treatment response|therapy response|disease progression|clinical outcome)|(?:treatment|therapy) response predict|disease progression|outcome predict/i,
 language:/(?:radiology |radiological |medical |image )?report generat|visual question|(?:image.text|text.image|image.report) retrieval|image.report|image.language|vision.language|radiolog.{0,20}report.{0,20}(?:understand|summari)|multimodal large language/i,
 intervention:/radiotherapy|radiation therapy plan|treatment planning|dose predict|surgical (?:plan|navig)|image.guided|interventional|intraoperative|computer.assisted surgery/i,
},
modalities:{MRI:/\bmri\b|magnetic resonance/i,CT:/\bct\b|computed tomograph/i,"X-ray":/x.ray|chest radiograph|mammograph/i,"超声":/ultrasound|ultrasonograph|echocardiograph/i,"PET / SPECT":/\bpet\b|\bspect\b|positron emission/i,"病理切片":/histopatholog|whole.slide|digital patholog|histolog/i,"眼底 / OCT":/fundus|retinal imag|optical coherence|\boct\b/i,"内镜":/endoscop|colonoscop|gastroscop/i},
organs:{"脑 / 神经":/\bbrain\b|glioma|cerebral|neuroimag|intracranial/i,"胸部 / 肺":/\blung\b|pulmonary|thoracic|\bchest\b/i,"腹部":/abdom|\bliver\b|hepatic|kidney|renal|pancrea|spleen/i,"心血管":/cardiac|cardiovascular|\bheart\b|coronary|\baorta\b/i,"乳腺":/\bbreast\b|mammograph/i,"眼科":/retin|fundus|ophthalm|\beye\b/i,"骨肌":/musculoskelet|\bbone\b|vertebr|spine|cartilage/i,"皮肤":/dermoscop|melanoma|skin (?:lesion|cancer)/i,"多器官":/multi.organ|multiple organs|whole.body/i,"肿瘤 / 病灶":/tumou?r|\blesion|\bcancer|neoplasm/i},
methods:{"基础模型":/foundation model|segment anything|\bmedsam\b|\bsam[- ]?med|\bsam 2\b|\bsam2\b|large vision.language model|universal (?:medical )?segmentation model/i,"提示式学习":/\bpromptable\b|\bprompt[- ](?:based|guided|conditioned)\b|\b(?:visual|textual|text|image|point|box|mask|learnable|soft|hard)[- ]prompt(?:s|ing)?\b|\bprompt[- ](?:learning|tuning|engineering|embeddings?|optimization|optimisation)\b/i,"自监督":/self.supervis|contrastive learn/i,"弱 / 半监督":/weakly.supervis|semi.supervis|few.shot/i,"生成式方法":/diffusion (?:model|probabilistic|transformer)|denoising diffusion|\bgenerative\b|\bgan\b/i,"域适应 / 泛化":/domain adapt|domain general|out.of.distribution|cross.domain/i,"联邦学习":/federated/i,"多模态":/multi.modal|vision.language|image.text/i,"主动学习":/active learn/i},
humanSignals:{interactive:/interactive (?:medical |image |tumou?r |organ |lesion )?segment|interactive correction|user.guided|clinician.guided|human.guided|manual correction|click.based|scribble.based/i,reader:/reader stud|reader performance|multi.reader|radiologist.{0,35}(?:with and without|assisted|unaided)|(?:assisted|unaided).{0,30}radiologist/i,assisted:/(?:ai|computer|algorithm).assisted.{0,35}(?:diagnos|radiolog|reader|clinician|interpret)|human.ai (?:collabor|team)|(?:physician|clinician).{0,25}decision support/i,feedback:/human.in.the.loop|human feedback|clinician feedback|expert feedback|human.ai collabor/i,simulated:/simulated (?:user|click|interaction|annotator)|user simulat|robot user/i,annotation:/expert annotat|radiologist annotat|manual annotat|expert ground.truth/i}
};
export function textOnly(value:unknown):string{return String(value??"").replace(/<\/?[a-z][^>]*>/gi," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g," ").replace(/&#(x[\da-f]+|\d+);/gi,(_,code:string)=>{const n=code[0].toLowerCase()==="x"?parseInt(code.slice(1),16):Number(code);return n<=0x10ffff?String.fromCodePoint(n):"�";}).replace(/\s+/g," ").trim();}
export function classify(title:string,abstract:string){
 const text=`${title}. ${abstract}`; const out:any={}; const evidence:{label:string;excerpt:string}[]=[];
 for(const [group,rules] of Object.entries(patterns)){
  out[group]=[];
  for(const [label,re] of Object.entries(rules)){
   const matches=[...text.matchAll(new RegExp(re.source,"gi"))];
   const match=matches.find(m=>{
    if(group!=="humanSignals"||label==="simulated")return true;
    const prefix=text.slice(Math.max(0,m.index!-100),m.index);
    const clause=prefix.split(/[.!?;]/).pop()??"";
    return !/\b(?:without|no|neither|does not require|did not involve|do not require|not requiring|eliminat(?:e|es|ing) the need for)\b[^,]{0,85}$/i.test(clause);
   });
   if(!match)continue;
   out[group].push(label);
   if(group==="humanSignals"&&match.index!==undefined)evidence.push({label:HUMAN_LABELS[label],excerpt:text.slice(Math.max(0,match.index-65),Math.min(text.length,match.index+180))});
  }
 }
 if(!out.tasks.length)out.tasks=["general"];
 const matches = new Set<string>(out.tasks.filter((task:string) => task in TRACKS));
 if(out.humanSignals.some((signal:string)=>signal!=="annotation"&&signal!=="simulated")) matches.add("human_loop");
 if(out.methods.includes("基础模型")) matches.add("foundation");
 // Task keywords alone (e.g. a text-only diagnostic chatbot) are not medical imaging evidence.
 out.tracks = relevant(title,abstract) ? Object.keys(TRACKS).filter(track => matches.has(track)) : [];
 out.evidence=evidence;return out as Pick<Paper,"tasks"|"modalities"|"organs"|"methods"|"humanSignals"|"evidence"|"tracks">;
}
/** Require imaging evidence, not just a disease or generic AI/clinical keyword. */
export function relevant(title:string,abstract:string){
 const raw=title+" "+abstract;
 const t=raw.replace(/\b(?:without|no|not(?: using)?|non)[ -](?:(?:the use of|any|using) )?(?:(?:medical|clinical|radiological) )?imag(?:e(?:s)?|ing)(?: (?:data|features|endpoints))?/gi," ");
 if(/plant disease|crop disease|remote sensing|satellite imag|agricultur|industrial defect|steel surface|sea ice|pavement/i.test(title)) return false;
 const imaging = /medical imag|biomedical imag|radiolog|radiograph|\bmri\b|magnetic resonance|computed tomograph|ultrasound|ultrasonograph|echocardiograph|histopatholog|histolog|digital patholog|whole.slide|fundus|retinal imag|mammograph|optical coherence tomograph|endoscop|colonoscop|dermoscop|positron emission|single.photon emission/i.test(t);
 const anatomy = /\b(?:brain|organ|lesion|tumou?r|liver|lung|cardiac|heart|renal|kidney|breast|retinal|prostate|pancrea\w*|bone|cancer)\b/i.test(t);
 const visualText = /\bpcr\b|cycle threshold/i.test(t) ? t.replace(/\bct\b/gi," ") : t;
 const visual = /\bimag(?:e|es|ing)\b|\b(?:ct|pet|spect|oct)\b|\bsegment(?:ation|ing|ed)?\b|delineat|contouring|radiomic/i.test(visualText);
 const patientGrouping = /(?:patient|cohort|population) segment|segment(?:ation|ing)? (?:of )?patients/i.test(t);
 return imaging || (anatomy && visual && !patientGrouping);
}
export function normalizeDoi(value:unknown){return String(value??"").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,"").trim().toLowerCase()||null;}
export function normalizedName(value:string){return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");}
