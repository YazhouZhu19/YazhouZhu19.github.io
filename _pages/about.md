---
permalink: /
title: ""
excerpt: ""
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

{% if site.google_scholar_stats_use_cdn %}
{% assign gsDataBaseUrl = "https://cdn.jsdelivr.net/gh/" | append: site.repository | append: "@" %}
{% else %}
{% assign gsDataBaseUrl = "https://raw.githubusercontent.com/" | append: site.repository | append: "/" %}
{% endif %}
{% assign url = gsDataBaseUrl | append: "google-scholar-stats/gs_data_shieldsio.json" %}

<span class='anchor' id='about-me'></span>

I am a Ph.D. student in Nanjing University of Science and Technology (NJUST), under the supervision of Prof. [Haofeng Zhang](https://scholar.google.com/citations?user=BRFfdhcAAAAJ&hl=en&oi=ao). 

My research interest includes few-shot medical image segmentation and computer vision. 



# 🔥 News
- *2025.10*: &nbsp;🎉🎉 One paper is accepted by IEEE Transactions on Image Processing.
- *2025.06*: &nbsp;🎉🎉 One paper is accepted by Artificial Intelligence in Medicine.
- *2025.06*: &nbsp;🎉🎉 One paper is accepted by MICCAI 2025. 

# 📝 Publications

## Cross-domain Few-shot Medical Image Segmentation

- **Cross-domain Few-shot Medical Image Segmentation via Dynamic Semantic Matching**
  <br>
  **Yazhou Zhu**, Shidong Wang, Tao Zhou, Zechao Li, Haofeng Zhang*, Ling Shao
  <br>
  **IEEE Transactions on Image Processing 2025**

- **MAUP: Training-free Multi-center Adaptive Uncertainty-aware Prompting for Cross-domain Few-shot Medical Image Segmentation**
  <br>
  **Yazhou Zhu**, Haofeng Zhang*
  <br>
  **MICCAI 2025**
  <br>
  [[Paper](https://arxiv.org/abs/2508.03511)] [[Code](https://github.com/YazhouZhu19/MAUP)]

- **RobustEMD: Domain Robust Matching for Cross-domain Few-shot Medical Image Segmentation**
  <br>
  **Yazhou Zhu**, Minxian Li, Qiaolin Ye, Shidong Wang, Tong Xin, Haofeng Zhang*
  <br>
  **Artificial Intelligence in Medicine 2025**
  <br>
  [[Paper](https://www.sciencedirect.com/science/article/abs/pii/S0933365725001320)] [[Code](https://github.com/YazhouZhu19/RobustEMD)]


## Few-shot Medical Image Segmentation

- **Partition-A-Medical-Image: Extracting Multiple Representative Sub-regions for Few-shot Medical Image Segmentation**
  <br>
  **Yazhou Zhu**, Shidong Wang, Tong Xin, Zheng Zhang, Haofeng Zhang*
  <br>
  **IEEE Transactions on Instrumentation and Measurement 2024**
  <br>
  [[Paper](https://ieeexplore.ieee.org/abstract/document/10478981/)] [[Code](https://github.com/YazhouZhu19/Partition-A-Medical-Image)]

- **Learning De-biased Prototypes for Few-shot Medical Image Segmentation**
  <br>
  **Yazhou Zhu**, Ziming Cheng, Shidong Wang, Haofeng Zhang*
  <br>
  **Pattern Recognition Letters 2023**
  <br>
  [[Paper](https://www.sciencedirect.com/science/article/abs/pii/S0167865524001417)] [[Code](https://github.com/YazhouZhu19/DMAP)]

- **Few-shot Medical Image Segmentation via a Region-enhanced Prototypical Transformer**
  <br>
  **Yazhou Zhu**, Shidong Wang, Tong Xin, Haofeng Zhang*
  <br>
  **MICCAI 2023**
  <br>
  [[Paper](https://link.springer.com/chapter/10.1007/978-3-031-43901-8_26)] [[Code](https://github.com/YazhouZhu19/RPT)]

## MRI Image Denoising

- **DESN: An Unsupervised MR Image Denoising Network with Deep Image Prior**
  <br>
  **Yazhou Zhu**, Xiang Pan*, Tianxu Lv, Yuan Liu, Lihua Li
  <br>
  **Theoretical Computer Science 2021**
  <br>
  [[Paper](https://www.sciencedirect.com/science/article/pii/S0304397521003522)]

- **Denoising of Magnetic Resonance Images with Deep Neural Regularizer Driven by Image Prior**
  <br>
  **Yazhou Zhu**, Xiang Pan*, Jing Zhu, Lihua Li, Yuan Liu
  <br>
  **IEEE-DSAA 2020**
  <br>
  [[Paper](https://drive.google.com/file/d/1Sg9mUTG0lJuRpfBl1KT2lp742E9HwPUN/view)]

## Medical Image Segmentation

- **Multi-scale Strategy based 3D Dual-encoder Brain Tumor Segmentation Network with Attention Mechanism**
  <br>
  **Yazhou Zhu**, Xiang Pan*, Jing Zhu, Lihua Li
  <br>
  **IEEE-BIBM 2020**
  <br>
  [[Paper](https://ieeexplore.ieee.org/document/9313089)] [[Code](https://github.com/YazhouZhu19/3D-Dual-Encoder)]


# 👻 Co-author Publications

- **Famnet: Frequency-aware Matching Network for Cross-domain Few-shot Medical Image Segmentation**
  <br>
  Yuntian Bo, **Yazhou Zhu**, Lunbo Li, Haofeng Zhang*
  <br>
  **AAAI 2025**
  <br>
  [[Paper](https://arxiv.org/abs/2412.09319)] [[Code](https://github.com/primebo1/FAMNet)]

- **Cascaded Alternating Refinement Transformer for Few-shot Medical Image Segmentation**
  <br>
  Ziming Cheng, **Yazhou Zhu**, Shidong Wang, Tong Xin, Haofeng Zhang*
  <br>
  **ACM Transactions on Intelligent Systems and Technology 2025**
  <br>
  [[Paper](https://dl.acm.org/doi/abs/10.1145/3709145)] [[Code](https://github.com/zmcheng9/CART)]

- **Class Concentration with Twin Variational Autoencoders for Unsupervised Cross-modal Hashing**
  <br>
  Yang Zhao, **Yazhou Zhu**, Shengbin Liao, Qiaolin Ye, Haofeng Zhang*
  <br>
  **ACCV 2022**
  <br>
  [[Paper](https://openaccess.thecvf.com/content/ACCV2022/html/Zhao_Class_Concentration_with_Twin_Variational_Autoencoders_for_Unsupervised_Cross-modal_Hashing_ACCV_2022_paper.html)] [[Code](https://github.com/theusernamealreadyexists/CCTV)]

- **Unsupervised Medical Images Denoising via Graph Attention Dual Adversarial Network**
  <br>
  Tianxu Lv, Xiang Pan*, **Yazhou Zhu**, Lihua Li
  <br>
  **Applied Intelligence 2021**
  <br>
  [[Paper](https://link.springer.com/article/10.1007/s10489-020-02016-4)]

  


# 📖 Educations
- *2022.03 - now*, Ph.D. student, Nanjing University of Science and Technology.
- *2018.09 - 2021.06*, Master, Jiangnan University. 
- *2014.09 - 2018.06*, Undergraduate, Changzhou University. 

