import type { Paper } from "./types";
export const TASKS: Record<string,string> = {segmentation:"分割与结构解析",diagnosis:"检测与辅助诊断",reconstruction:"重建、增强与生成",registration:"配准与运动跟踪",quantification:"定量影像与标志物",prognosis:"预后与疗效预测",language:"影像与语言理解",intervention:"治疗规划与导航",general:"跨任务研究"};
export const TRACKS:Record<string,string>={segmentation:"器官与病灶分割",human_loop:"人在回路临床诊断"};
export const HUMAN_LABELS:Record<string,string>={interactive:"交互分割 / 修正",reader:"读片者评估线索",assisted:"AI辅助诊断线索",feedback:"人类反馈 / 在回路",simulated:"含模拟交互",annotation:"专家标注 / 参考标准"};
const patterns:Record<string,Record<string,RegExp>>={
tasks:{segmentation:/\bsegment(?:ation|ing|ed)?\b|delineat|contouring/i,diagnosis:/\bdiagnos|(?:lesion|nodule|tumou?r|disease) (?:detect|classif)|screening/i,reconstruction:/image reconstruct|tomographic reconstruct|super.resolution|denois|image synthes|cross.modal.*generat|artifact (?:reduc|correct)/i,registration:/(?:image|deformable|rigid|multimodal) registration|deformable.*align|motion (?:estimat|track)|image alignment/i,quantification:/radiomic|imaging biomarker|quantitative imag|morphometr/i,prognosis:/prognos|survival predict|treatment response predict|disease progression|outcome predict/i,language:/report generat|visual question|image.text retrieval|image.report|image.language|text.image retrieval/i,intervention:/radiotherapy planning|radiation therapy plan|surgical (?:plan|navig)|image.guided|interventional|intraoperative/i},
modalities:{MRI:/\bmri\b|magnetic resonance/i,CT:/\bct\b|computed tomograph/i,"X-ray":/x.ray|chest radiograph|mammograph/i,"超声":/ultrasound|ultrasonograph|echocardiograph/i,"PET / SPECT":/\bpet\b|\bspect\b|positron emission/i,"病理切片":/histopatholog|whole.slide|digital patholog|histolog/i,"眼底 / OCT":/fundus|retinal imag|optical coherence|\boct\b/i,"内镜":/endoscop|colonoscop|gastroscop/i},
organs:{"脑 / 神经":/\bbrain\b|glioma|cerebral|neuroimag|intracranial/i,"胸部 / 肺":/\blung\b|pulmonary|thoracic|\bchest\b/i,"腹部":/abdom|\bliver\b|hepatic|kidney|renal|pancrea|spleen/i,"心血管":/cardiac|cardiovascular|\bheart\b|coronary|\baorta\b/i,"乳腺":/\bbreast\b|mammograph/i,"眼科":/retin|fundus|ophthalm|\beye\b/i,"骨肌":/musculoskelet|\bbone\b|vertebr|spine|cartilage/i,"皮肤":/dermoscop|melanoma|skin (?:lesion|cancer)/i,"多器官":/multi.organ|multiple organs|whole.body/i,"肿瘤 / 病灶":/tumou?r|\blesion|\bcancer|neoplasm/i},
methods:{"基础模型":/foundation model|segment anything|\bmedsam\b|\bsam 2\b|\bsam2\b/i,"提示式学习":/prompt(?:able|ing|.based)?/i,"自监督":/self.supervis|contrastive learn/i,"弱 / 半监督":/weakly.supervis|semi.supervis|few.shot/i,"生成式方法":/diffusion (?:model|probabilistic|transformer)|denoising diffusion|generative|\bgan\b/i,"域适应 / 泛化":/domain adapt|domain general|out.of.distribution|cross.domain/i,"联邦学习":/federated/i,"多模态":/multi.modal|vision.language|image.text/i,"主动学习":/active learn/i},
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
 out.tracks=[...(out.tasks.includes("segmentation")?["segmentation"]:[]),...(out.humanSignals.some((x:string)=>x!=="annotation"&&x!=="simulated")?["human_loop"]:[])];out.evidence=evidence;return out as Pick<Paper,"tasks"|"modalities"|"organs"|"methods"|"humanSignals"|"evidence"|"tracks">;
}
export function relevant(title:string,abstract:string){const t=title+" "+abstract;return /medical imag|radiolog|\bmri\b|magnetic resonance|computed tomograph|\bct\b|ultrasound|histopatholog|fundus|retin|mammograph|organ|tumou?r|lesion|brain|liver|lung|radiograph|endoscop|clinical diagnos/i.test(t)&&!/plant disease|crop disease|remote sensing|satellite imag|agricultur|industrial defect|steel surface|sea ice|pavement/i.test(title);}
export function normalizeDoi(value:unknown){return String(value??"").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,"").trim().toLowerCase()||null;}
export function normalizedName(value:string){return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");}
