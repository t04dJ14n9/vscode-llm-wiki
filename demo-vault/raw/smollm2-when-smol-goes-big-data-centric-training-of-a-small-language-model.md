---
type: "Paper"
title: "SmolLM2: When Smol Goes Big -- Data-Centric Training of a Small Language Model"
description: "While large language models have facilitated breakthroughs in many applications of artificial intelligence, their inherent largeness makes them computationally expensive and challenging to deploy in resource-constrained settings."
resource: "https://arxiv.org/abs/2502.02737v1"
tags: ["paper"]
status: "stable"
generated: {"by": "process:arxiv-ingest", "at": "2026-08-12T21:00:09Z"}
sources: [{"id": "arxiv-record", "resource": "https://arxiv.org/abs/2502.02737v1", "title": "arXiv record for SmolLM2: When Smol Goes Big -- Data-Centric Training of a Small Language Model", "last_modified": "2025-02-04"}]
authors: ["Allal, Loubna Ben", "Lozhkov, Anton", "Bakouch, Elie", "Blázquez, Gabriel Martín", "Penedo, Guilherme", "Tunstall, Lewis", "Marafioti, Andrés", "Kydlíček, Hynek", "Lajarín, Agustín Piqueres", "Srivastav, Vaibhav", "Lochner, Joshua", "Fahlgren, Caleb", "Nguyen, Xuan-Son", "Fourrier, Clémentine", "Burtenshaw, Ben", "Larcher, Hugo", "Zhao, Haojun", "Zakka, Cyril", "Morlon, Mathieu", "Raffel, Colin", "von Werra, Leandro", "Wolf, Thomas"]
source_type: "paper"
source_url: "https://arxiv.org/abs/2502.02737v1"
ingested: "2026-08-13"
submitted: "2025-02-04"
revised: "2025-02-04"
sha256: "1a27861eb5bdc90dc80a414c861f54532cd2e2b6ba2e5ea615809710ec6f4c1d"
arxiv: {"id": "2502.02737", "version": 1}
license: {"id": "CC-BY-4.0", "url": "https://creativecommons.org/licenses/by/4.0/"}
attachment: {"resource": "../assets/smollm2-when-smol-goes-big-data-centric-training-of-a-small-language-model.pdf", "media_type": "application/pdf", "bytes": 640228, "sha256": "a95fbda201d21cd25c89e949636373d36c288bd2d287e3cabd208e2041ea36d3", "role": "original"}
extraction: {"tool": "pdftotext", "version": "pdftotext version 26.04.0"}
---

                                                                        SmolLM2: When Smol Goes Big —
                                                                  Data-Centric Training of a Small Language Model


                                                Loubna Ben Allal * Anton Lozhkov * Elie Bakouch * Gabriel Martín Blázquez * Guilherme Penedo
                                                 Lewis Tunstall Andrés Marafioti Hynek Kydlíček Agustín Piqueres Lajarín Vaibhav Srivastav
                                                Joshua Lochner Caleb Fahlgren Xuan-Son Nguyen Clémentine Fourrier Ben Burtenshaw
                                                                   Hugo Larcher Haojun Zhao Cyril Zakka Mathieu Morlon
                                                                         Colin Raffel Leandro von Werra Thomas Wolf




arXiv:2502.02737v1 [cs.CL] 4 Feb 2025
                                                                                 Hugging Face
                                                https://hf.co/collections/HuggingFaceTB/smollm2-6723884218bcda64b34d7db9

                                                                  Abstract                                  (Touvron et al., 2023; Bai et al., 2023; Brown et al., 2020;
                                              While large language models have facilitated                  Dubey et al., 2024; Groeneveld et al., 2024; Chowdhery
                                              breakthroughs in many applications of artificial              et al., 2023; Young et al., 2024; Taylor et al., 2022). LLMs
                                              intelligence, their inherent largeness makes them             are, by their nature, large, in the sense that they are models
                                              computationally expensive and challenging to de-              with many parameters (more than ~10 billion, by current
                                              ploy in resource-constrained settings. In this pa-            conventions). This enormity results in enormous computa-
                                              per, we document the development of SmolLM2,                  tional costs, both during training and for inference, which
                                              a state-of-the-art “small” (1.7 billion parameter)            can prevent LLMs from being used in resource-constrained
                                              language model (LM). To attain strong perfor-                 settings. To address this issue, a flurry of recent work has
                                              mance, we overtrain SmolLM2 on ~11 trillion                   aimed to produce performant small (~3 billion parameters or
                                              tokens of data using a multi-stage training pro-              less) LMs (Gunter et al., 2024; Yang et al., 2024b; AI@Meta,
                                              cess that mixes web text with specialized math,               2024b; Team et al., 2024; Li et al., 2023b). These small
                                              code, and instruction-following data. We addi-                LMs are computationally inexpensive and can be run on a
                                              tionally introduce new specialized datasets (Fine-            wider range of devices (e.g. mobile phones) while providing
                                              Math, Stack-Edu, and SmolTalk) at stages where                satisfactory performance on many important tasks.
                                              we found existing datasets to be problematically              A key factor in the performance and behavior of LMs is the
                                              small or low-quality. To inform our design deci-              data used to train them. While important for an LM of any
                                              sions, we perform both small-scale ablations as               size, data curation has an especially outsized influence for
                                              well as a manual refinement process that updates              smaller models, as their limited capacity must be carefully
                                              the dataset mixing rates at each stage based on               optimized for learning core knowledge and fundamental
                                              the performance at the previous stage. Ultimately,            capabilities rather than memorizing incidental facts (Abdin
                                              we demonstrate that SmolLM2 outperforms other                 et al., 2024a; Rolnick et al., 2017). Most LMs are primarily
                                              recent small LMs including Qwen2.5-1.5B and                   trained on text crawled from the web (Radford et al., 2019;
                                              Llama3.2-1B. To facilitate future research on LM              Raffel et al., 2020) and state-of-the-art pipelines include
                                              development as well as applications of small LMs,             sophisticated filtering and processing stages that aim to
                                              we release both SmolLM2 as well as all of the                 improve data quality (Li et al., 2024c; Penedo et al., 2024b;a;
                                              datasets we prepared in the course of this project.           Soldaini et al., 2024). Recently, it has become common to
                                                                                                            include “specialized” data from certain domains such as
                                        1. Introduction                                                     software code (Kocetkov et al., 2022; Lozhkov et al., 2024)
                                                                                                            and mathematics (Paster et al., 2023; Han et al., 2024),
                                        Large language models (LMs) have become a cornerstone of            which can improve performance not only on those domains
                                        modern AI systems due to their ability to follow natural lan-       but also more generally on challenging tasks that require
                                        guage instructions and flexibly perform a huge range of tasks       reasoning (Muennighoff et al., 2023; Aryabumi et al., 2024).
                                          *
                                           Equal contribution . Correspondence to: Loubna Ben Allal         Motivated by the above considerations, our contributions
                                        <loubna@hf.co>, Leandro von Werra <leandro@hf.co>, Thomas
                                                                                                            in this paper are as follows: First, we perform a careful
                                        Wolf <thomas@hf.co>.
                                                                                                            evaluation of existing web, code, math, and instruction-
                                        Preprint. Under review.                                             following datasets (Section 3) to help guide training data

                                                                                                        1
                                                            SmolLM2

design choices, ultimately training SmolLM2 via a multi-               Wang et al., 2022). This process provides a valuable way
stage manual rebalancing of different sources to maximize              of tailoring LMs to provide helpful responses rather than
performance (Section 4). Such on-the-fly rebalancing is                simply attempting to continue the input (as taught during
a promising approach for large-scale training runs which               pretraining). During preference learning, language models
can be sufficiently costly (around 1e23 FLOPs, or $250,000             are further “aligned” towards their intended use by being
USD worth of GPU compute for SmolLM2) to preclude                      trained to distinguish between helpful and unhelpful re-
running multiple full-scale training runs. Following stan-             sponses (Ouyang et al., 2022; Bai et al., 2022). This final
dard practice, we also develop an instruction-tuned variant            stage typically involves a form of reinforcement learning
of SmolLM2 (Section 5). Additionally, after finding that ex-           (Bai et al., 2022; Lee et al.; Rafailov et al., 2024) on data
isting datasets were too small and/or low-quality, we created          labeled with human or synthetically generated preferences.
the new datasets FineMath, Stack-Edu, and SmolTalk (for
mathematics, code, and instruction-following respectively).            3. Pretraining datasets
Ultimately, we show that both the base and instruction-tuned
variants of SmolLM2 are state-of-the-art among similarly               Pretraining data curation is especially important for small
sized models (Section 4.7 and Section 5.4).                            LMs due to their tendency to be more sensitive to noise in
                                                                       the training data (Rolnick et al., 2017; Abdin et al., 2024a).
2. Background                                                          In addition, designing a pretraining strategy involves not
Training a modern LM typically begins with “pretraining”               only selecting and curating data, but also determining how
on a large amount (e.g. trillions of tokens) of unstructured           much to “mix” (i.e. sample) from different sources, which
text. Pretraining helps the model fit the structure of language        can be particularly important when including e.g. special-
(Clark, 2019) and store factual knowledge (Petroni et al.,             ized math and code datasets. We therefore undertook a care-
2019; Roberts et al., 2020) and therefore has proven to be             ful evaluation of existing datasets and, wherever we deemed
a vital part of LM training, which made the composition                necessary, created new, improved, and larger datasets.
of the pretraining dataset a key consideration. The data-
hungry nature of pretraining has led to the use of large-              3.1. Ablation setup
scale web scrapes (com; ope; ant) which in their raw form
                                                                       To compare English web datasets and find the best mixture
can lead to poorly performing LMs (Penedo et al., 2024b).
                                                                       for training our models, we followed an empirical approach
Consequently, the primary means of curation for modern
                                                                       similar to Penedo et al. (2024a). Specifically, we trained
LM pretraining datasets involves designing sophisticated
                                                                       models on each dataset under identical conditions: model
pipelines for automatically filtering and reformatting web
                                                                       configuration, training hyperparameters, and token count.
texts (Penedo et al., 2024a;b; Soldaini et al., 2024; Soboleva
                                                                       We trained 1.7B parameter Transformers (Vaswani et al.,
et al., 2023; Li et al., 2024c) that aim to keep enough data
                                                                       2017) based on the Llama architecture (Touvron et al., 2023),
to avoid detrimental repetition (Muennighoff et al., 2023)
                                                                       with a sequence length of 2048, a global batch size of ap-
while discarding any data that is not “high-quality”.
                                                                       proximately 2 million tokens, the GPT-2 tokenizer (Radford
Apart from web text, including “specialized” data from                 et al., 2019), and a cosine learning rate schedule (Loshchilov
certain domains – code (Kocetkov et al., 2022; Li et al.,              & Hutter, 2016) with a learning rate of 3.0 × 10−4 . Each
2023a) and math (Paster et al., 2023; Han et al., 2024;                dataset ablation model is trained on 350B tokens randomly
Wang et al.; Azerbayev et al., 2023) in particular – can               sampled from the full dataset. For evaluation, we also fol-
improve model performance on tasks that involve reasoning              lowed Penedo et al. (2024a), and used lighteval to eval-
and world knowledge (Muennighoff et al., 2023; Aryabumi                uate on a variety of knowledge, reasoning, and text under-
et al., 2024; Lewkowycz et al., 2022; Shao et al., 2024). The          standing benchmarks: MMLU (Hendrycks et al., 2021),
contribution of small specialized datasets can be dwarfed              HellaSwag (Zellers et al., 2019), OpenBook QA (Mihaylov
by much larger web-based pretraining data sources, which               et al., 2018), PIQA (Bisk et al., 2019), WinoGrande (Sak-
has led to the design of multi-stage pretraining where spe-            aguchi et al., 2019), ARC (Clark et al., 2018), and Common-
cialized or high-quality datasets are incorporated later in            SenseQA (Talmor et al., 2019).
training (Abdin et al., 2024b; Ai2, 2024; Blakeney et al.,
                                                                       Math and code capabilities typically emerge only after ex-
2024; Singer et al., 2024).
                                                                       tensive training, so similarly to Blakeney et al. (2024);
After pretraining, language models typically undergo two ad-           Dubey et al. (2024); Ai2 (2024), when evaluating math
ditional training stages before deployment: instruction tun-           and code datasets we started from a mid-training check-
ing and preference learning. In instruction tuning, the model          point of SmolLM2 at 3T tokens (detailed in Section 4),
undergoes supervised training on instruction/response pairs            which was trained primarily on web data. We then used
that reflect the way that the language model should answer a           an annealing approach: the learning rate linearly decays
query (Wei et al., 2021; Mishra et al., 2021; Sanh et al., 2021;       to 0 while training on a mixture that includes the dataset

                                                                   2
                                                              SmolLM2

                                                                      aligning with DCLM’s results on HellaSwag and approach-
Table 1. Evaluation of models trained on FineWeb-Edu and DCLM
                                                                      ing its performance on CommonSenseQA. Combining these
for 350B tokens. 40/60 and 60/40 denote the FW-Edu/DCLM ratio.
                                                                      datasets yields 5.1T tokens of (English) text.
  Task                 FW-Edu      DCLM      40/60    60/40
  MMLU                   37.5       35.5      36.5    37.0            3.3. Math data
  ARC                    57.5       53.5      53.2    56.0
  OpenBookQA             41.9       40.8      39.0    41.9            Specialized math pretraining data is crucial for developing
  HellaSwag              60.1       62.3      61.4    62.2            robust mathematical understanding. Recent research has
  CommonsenseQA          36.2       40.1      39.9    38.5            shown that carefully curated mathematical content from
  PIQA                   76.2       76.9      75.7    76.4
                                                                      Common Crawl, combined with targeted filtering tech-
                                                                      niques, can significantly enhance language models’ math-
                                                                      ematical reasoning capabilities (Dubey et al., 2024; Yang
under evaluation. For math, we annealed on a mixture
                                                                      et al., 2024c; Shao et al., 2024; Han et al., 2024).
of 60B tokens of the dataset under evaluation and 40B
from the pre-checkpoint mixture. For code ablations,
                                                                      3.3.1. C OMPARISON OF E XISTING DATASETS
we performed annealing on 200B tokens, uniformly dis-
tributed across 15 of the most commonly used program-                 We compare two leading publicly available math datasets:
ming languages (~14B tokens each). We evaluated the                   OpenWebMath (OWM) (Paster et al., 2023) and InfiMM-
math ablation models on GSM8K (Cobbe et al., 2021),                   WebMath (Han et al., 2024). OWM consists of 12B to-
MATH (Hendrycks et al., 2021) and MMLU-STEM to as-                    kens, built by filtering math-specific content from Common
sess their math capabilities using lighteval, and we used             Crawl and using a specialized text extraction pipeline to
HumanEval (Chen et al., 2021) and MultiPL-E (Cassano                  preserve mathematical formatting and equations. InfiMM-
et al., 2022) to evaluate the code ablation models using the          WebMath contains 40B text tokens, and its authors show
BigCode-Evaluation-Harness.                                           that it matches the performance of the private dataset of
                                                                      DeepSeekMath (Shao et al., 2024).
3.2. English web data                                                 We performed annealing ablations (following the setup de-
Web text from Common Crawl has remained a popular                     scribed in Section 3.1) on OWM and InfiMM-WebMath,
source of pretraining data, and recent classifier-based filter-       finding that InfiMM-WebMath achieves a peak accuracy of
ing techniques have significantly advanced pretraining data           14% on GSM8K compared to OWM’s 10%, while OWM
quality (Dubey et al., 2024; Abdin et al., 2024b;a; Kong              slightly outperforms InfiMM-WebMath on MATH. The full
et al., 2024). Two prominent examples of open datasets                evaluation curves are available in Appendix C.1. Despite
that use classifer-based filtering are FineWeb-Edu (Penedo            training on 60B math tokens (i.e., 5 epochs for OWM and
et al., 2024a) and DCLM (Li et al., 2024c). FineWeb-                  1.5 epochs for InfiMM-WebMath), performance still lagged
Edu consists of 1.3T tokens that were deemed “educa-                  behind proprietary state-of-the-art small models (Yang et al.,
tional” by a classifier trained on annotations generated by           2024b). Further analysis highlighted two key limitations:
Llama3-70B-Instruct (Dubey et al., 2024). DCLM com-                   insufficient dataset sizes, and insufficient focus on step-by-
prises 3.8T tokens filtered using a fastText classifier (Joulin       step mathematical reasoning, along with an overrepresenta-
et al., 2016a;b) trained on instruction-following data from           tion of academic papers that focus on advanced concepts.
OpenHermes 2.5 (Teknium, 2023a) and high-scoring posts
from the r/ExplainLikeImFive (ELI5) subreddit. Training               3.3.2. N EW DATASET: F INE M ATH
ablation models on 350B tokens each from FineWeb-Edu                  The aforementioned issues with OWM and InfiMM-
and DCLM attained performance shown in Table 1. We                    WebMath motivated us to develop FineMath1 , a collection
find that FineWeb-Edu achieves higher scores on the ed-               of up to 54B tokens of math data focusing on mathematical
ucational benchmarks MMLU, ARC, and OpenBookQA,                       deduction and reasoning through classifier-based filtering.
while DCLM performs better on HellaSwag and Common-
senseQA. These results align with the datasets’ content:              We began by extracting text from Common Crawl WARC
FineWeb-Edu prioritizes educational material, while DCLM              files using Resiliparse, focusing on all 5.8B unique URLs
captures more diverse, conversational styles.                         from the FineWeb dataset (a subset of Common Crawl’s
                                                                      75B unique URLs). We then employed the FineWeb-Edu
Given the complementary strengths of FineWeb-Edu and                  filtering approach, using Llama-3.1-70B-Instruct (Dubey
DCLM, we explored whether mixing them could further im-               et al., 2024) with a prompt (Appendix C.2) that scores con-
prove performance. After testing different ratios, we found           tent on a 3-point scale, where 1 indicates some mathematical
that a 60% FineWeb-Edu and 40% DCLM mix works well,
                                                                         1
as shown in Table 1: It nearly matches FineWeb-Edu’s per-                    https://huggingface.co/datasets/HuggingFaceTB/finemath
formance on MMLU, ARC, and OpenBookQA while also

                                                                  3
                                                           SmolLM2

content and 3 indicates step-by-step problem solutions at an                                 FineMath4+               Infi-WebMath4+                 OWM
appropriate level. After training a classifier on these silver                               FineMath3+               Infi-WebMath3+                 Infi-WebMath
labels, we identified domains containing at least 10 pages                                   GSM8K                      MATH                        MMLU STEM
                                                                                                               0.06
with a quality score of 2 or higher. We expanded our do-
                                                                                 0.20                                                    0.40

                                                                      Accuracy
main coverage by including domains with at least 10 URLs                                                       0.04
                                                                                 0.15                                                    0.38
from either OWM or InfiMM-WebMath. From the Common
                                                                                 0.10                          0.02
Crawl index, we retrieved a total of 7.7B URLs belonging                                                                                 0.36
to this list of domains: 5.7B identified by our classifier,                             0       50       100              50       100          0        50       100
                                                                                            Tokens (B)                Tokens (B)                     Tokens (B)
0.6B from OWM, and 1.3B from InfiWebMath. We then
re-extracted all identified pages using the OWM pipeline,
                                                                       Figure 1. Performance of models trained on different subsets of
preserving LaTeX formatting and removing all-boilerplate
                                                                       FineMath and other math datasets.
pages, yielding 7.1B pages containing 6.5T tokens.
                                                                       shown that including code data in pretraining enhances not
To retain only high-quality math content, we reapplied a               only code-related capabilities but also improves natural lan-
classifier trained on Llama-3.1-70B-Instruct annotations               guage reasoning and world knowledge (Aryabumi et al.,
using a 5-point scale prompt (Appendix C.3) specifically               2024). The Stack datasets are state-of-the-art open code
targeting pages with reasoning and middle- to high-school-             datasets (Li et al., 2023a; Kocetkov et al., 2022), including
level content. We note that InfiMM-WebMath used a similar              Stack v1, ~3TB of source code from public GitHub reposito-
classifier filtering pipeline, but their prompt did not target         ries; StarCoderData (Li et al., 2023a; Kocetkov et al., 2022;
the same type of content. After classification, we performed           Lozhkov et al., 2024), a filtered subset of 250 billion tokens
deduplication using single-band MinHash LSH (Broder,                   across 80 programming languages; Stack v2, with ~32TB of
1997) with 10 hashes and applied fastText language classifi-           data sourced from the Software Heritage code archive; and
cation (Joulin et al., 2016a;b) to retain only English content.        StarCoder2Data, the training corpus for StarCoder2 mod-
Ultimately, we developed multiple variants of FineMath, in-            els (Lozhkov et al., 2024) with 900 billion tokens spanning
cluding FineMath4+ (10B tokens, 6.7M documents) which                  more than 600 programming languages.
retains only samples with scores of 4-5 and FineMath3+
(34B tokens, 21.4M documents) which includes scores 3-                 Stack-Edu Recent work has shown that the FineWeb-Edu
5. We additionally applied the same classifier to InfiMM-              classifier-based filtering strategy can be effective for code
WebMath, creating Infi-WebMath4+ (8.5B tokens, 6.3M                    data (Wei et al., 2024b; Allal et al., 2024). We therefore
documents) and Infi-WebMath3+ (20.5B tokens, 13.9M                     constructed Stack-Edu, a filtered variant of StarCoder2Data
documents). Similarly to Yang et al. (2024c), we decon-                focusing on educational and well-documented code. Specif-
taminate each dataset against GSM8K, MATH and MMLU                     ically, we selected the 15 largest programming languages
using 13-gram matching and a minimum overlap ratio with                from StarCoder2Data to match the capacity constraints of
the longest common subsequence of 0.6.                                 smaller models (Lozhkov et al., 2024) and ensure bench-
                                                                       mark coverage for the ablations. This subset had ~450 bil-
                                                                       lion tokens. We then trained 15 language-specific classifiers
Results Figure 1 presents our FineMath annealing abla-
                                                                       using the StarEncoder model (Li et al., 2023a) on synthetic
tions. All FineMath subsets consistently outperform OWM
                                                                       annotations generated by Llama3-70B-Instruct (Dubey et al.,
and InfiMM-WebMath on GSM8K, MATH, and MMLU-
                                                                       2024) (prompt in Appendix D.1), which rated the educa-
STEM. FineMath4+ achieves a 2x improvement on GSM8K
                                                                       tional quality on a scale from 0 to 5. Each classifier was
and a 6x improvement on MATH compared to InfiMM-
                                                                       trained on 500,000 samples and achieved an F1 score above
WebMath, demonstrating the importance of retaining high-
                                                                       0.7 for most languages when applying a threshold of 3 for
quality mathematical content with reasoning. Addition-
                                                                       binary classification.
ally, Infi-WebMath4+ outperforms InfiMM-WebMath, but
plateaus after 80B tokens (roughly 10 epochs), likely due to           To evaluate Stack-Edu, we performed annealing ablations
data repetition, a trend not seen in FineMath4+.                       as described in Section 3.1. Filtering with a threshold of 3
                                                                       improved performance across most languages while main-
3.4. Code data                                                         taining sufficient data, although Java performed better with
Code generation and understanding are becoming essential               threshold 2. Since Markdown is not included in the MultiPL-
capabilities for modern LLMs, enabling diverse use cases               E benchmark, we could not determine a threshold for the
such as code completion, debugging, and software design.               dataset quantitatively; instead, we used threshold 3 based
While specialized code models (Lozhkov et al., 2024; Bai               on qualitative analysis. The resulting Stack-Edu dataset
et al., 2023; Roziere et al., 2023) are optimized specifically         contains ~125B tokens across its 15 languages (see Ap-
for these tasks, general-purpose LLMs are increasingly de-             pendix D.2). Table 2 shows the statistics of the top 4 pro-
ployed as coding assistants. Moreover, recent research has             gramming languages in terms of size, and the impact of our

                                                                  4
                                                              SmolLM2

                                                                                  English Web                OWM/InfiMM-WebMath/FineMath
Table 2. Stack-Edu dataset statistics and MultiPL-E scores for the                StarCoderData/Stack-Edu    Textbooks
top 4 (in terms of size) programming languages. We use Hu-                      10%                              5%              10%            4%      4%
                                                                                                                                               14%     14%
manEval for Python evaluation.                                                                                   20%             16%
Language     StarCoder2Data    Stack-Edu         MultiPL-E                                                                                     24%     24%
                  (B tokens)   (B tokens)   (Original → Filtered)
Python                  50.6         21.8       20.7 → 25.6                     90%
                                                                                                                 75%             74%
C++                     69.7         16.0       16.7 → 24.8                                                                                    58%     58%
JavaScript              45.3         11.1       18.2 → 22.4
Java                    45.6         42.1       17.6 → 22.7
                                                                            0                               6T              8T              10T 11T
                                                                                            Stage 1               Stage 2         Stage 3    Stage 4
educational filtering on MultiPL-E.
                                                                         Figure 2. Dataset mixtures across training stages. Detailed descrip-
                                                                         tions are provided in Section 4. The x-axis represents the number
4. Pretraining                                                           of training tokens.
Recent trends in language models pretraining show a clear
shift towards significantly longer training durations, espe-             4.1. Training setup
cially for smaller models (Yang et al., 2024a;b; AI@Meta,                Our base model contains 1.7B parameters and follows the
2024b). While this strategy deviates from the Chinchilla-                LLama2 (Touvron et al., 2023) architecture, outlined in Ap-
optimal guidelines (Hoffmann et al., 2022), the resulting                pendix A. We trained the model on 256 H100s using the
performance gains and reduced inference costs make ex-                   nanotron framework and use AdamW optimizer with
tended training a worthwhile trade-off (de Vries, 2023).                 (β, β2 ) = (0.9, 0.95) with a Warmup Stable Decay (WSD)
For example, Qwen2-1.5B was trained on 7 trillion tokens,                (Hu et al., 2024; Zhai et al., 2022) learning rate schedule
Qwen2.5-1.5B on 18 trillion tokens, and Llama3.2-1B, de-                 to avoid setting a fixed training duration (see Figure 3, Ap-
rived from a pruned 8B model, was trained using distillation             pendix A). The schedule started with a 2,000-step warmup
on 9 trillion tokens (Yang et al., 2024a;b; AI@Meta, 2024b).             phase, maintained a peak learning rate of 5.0 × 10−4 (stable
When building SmolLM2, we trained on 11 trillion tokens                  phase), and could transition to a decay phase when needed,
(approximately two epochs on our collected datasets), em-                reducing the learning rate to zero over 10% of the total train-
ploying a multi-stage training approach instead of a fixed               ing steps (Hägele et al., 2024). We used the tokenizer from
dataset mixture throughout pretraining. This design was                  Allal et al. (2024), which has a vocabulary size of 49,152 to-
guided by four key principles: (1) Performance-driven                    kens and was trained on a mixture of 70% of FineWeb-edu,
interventions, where we monitor evaluation metrics on key                15% Cosmopedia-v2, 8% OpenWebMath, 5% StarCoder-
benchmarks and adapt dataset mixtures to address specific                Data and 2% StackOverflow.
capability bottlenecks; (2) Upsampling high-quality math
and code during the annealing phase, reserving datasets                  4.2. Stable phase: stage 1
like FineMath and parts of Stack-Edu for the final stages to
                                                                         Data mixture In the first phase of SmolLM2’s pretraining
maximize their impact (Blakeney et al., 2024; Ai2, 2024);
                                                                         (0 to 6T tokens), we designed our dataset mixture based on
(3) Strategic introduction of medium-sized datasets, such
                                                                         insights from our English web ablations and existing liter-
as OWM, InfiMM-WebMath, and Stack-Edu, mid-training
                                                                         ature. We adopted a 60% FineWeb-Edu and 40% DCLM
to avoid dilution by larger datasets early on; and (4) Avoid-
                                                                         ratio (discussed in Section 2.2) for web data, which pro-
ing excessive data repetition, in line with Muennighoff
                                                                         vided an optimal balance between educational content and
et al. (2023) we aimed to stay close to the recommended
                                                                         diverse, real-world Q&A-style data. For code data, fol-
4–5 epoch threshold for most datasets. While it might be
                                                                         lowing Aryabumi et al. (2024), we incorporated StarCoder-
fruitful to perform multiple from-scratch training runs to
                                                                         Data, consisting of 250B tokens across 80 programming
explore different data mixing schedules, the high cost of
                                                                         languages, and limited it to 10% of the total mixture to en-
pretraining SmolLM2 (around $250,000 USD of GPU com-
                                                                         sure approximately 4 epochs over 11T tokens with room for
pute) motivated our “online” approach.
                                                                         upsampling in later stages. We did not include math data in
In the following sections, we describe each stage of the                 stage 1 due to our math datasets’ relatively small size.
training process, detailing the dataset mixtures, the ratio-
nale behind our choices, and the observations that guided                Findings After 6T tokens of training, we evaluated
our interventions. While some decisions were informed by                 SmolLM2 on key benchmarks, as shown in Table 3. Knowl-
established findings in the literature, others were driven by            edge and reasoning performance aligned with expectations
empirical insights gathered during training. The data mix-               based on our English web ablation results. However, we ob-
tures of the four pretraining phases are available in Figure 2.          served generally poor coding and mathematics performance.

                                                                     5
                                                               SmolLM2

                                                                      also added Jupyter Notebooks from StarCoder2 (Lozhkov
Table 3. Average model performance on different benchmark cat-
                                                                      et al., 2024), which provides rich, contextual examples of
egories after each training stage. Stages 1-3 are during stable
phase (no decay). Full per-benchmark results in Appendix E.1.         code interleaved with explanations, enhancing the model’s
                                                                      reasoning around programming tasks.
                         Stage 1   Stage 2   Stage 3   Stage 4
  Tokens                  0-6T      6-8T      8-10T    10-11T
  Knowledge/Reasoning    55.50     56.76     57.47     60.24
  Math                   3.21       3.7       7.27     22.07          Findings While the integration of these new datasets
  Code                   8.87      10.56     16.75     23.21          brought improvements across multiple benchmarks, we ob-
  Generative Tasks       31.54     31.30     34.70     36.12          served a noticeable loss spike during this phase which re-
                                                                      mained even after rewinding training and skipping data asso-
4.3. Stable phase: stage 2                                            ciated with the spike (Chowdhery et al., 2023; Almazrouei
                                                                      et al., 2023). The exact cause remains undetermined but
Data mixture For stage 2 (6T to 8T tokens), we added
                                                                      most evaluation metrics recovered by the end of the stage.
OWM to the mixture at a 5% ratio and increased the propor-
tion of code data in hopes of maintaining strong knowledge            4.5. Decay phase: stage 4
retention while addressing observed gaps in coding and
mathematical reasoning. Including OWM at a low percent-               Data mixture The final stage consisted of decaying the
age reflects the dataset’s small size (12B tokens) and our            learning rate linearly to 0 for 10% of the total training du-
gradual approach to incorporating math content. The fi-               ration (from 10T to 11T tokens) (Hägele et al., 2024). Fol-
nal mixture for stage 2 consisted of 75% English web data             lowing Blakeney et al. (2024), we introduced our highest
(keeping the 60/40 FineWeb-Edu to DCLM ratio from stage               quality mathematical datasets, InfiWebMath-3+, and Fine-
1), 20% code data, and 5% math data, as shown in Figure 2.            Math 4+. We additionally allocated 0.08% of the mixture
                                                                      to OWM and 0.02% to AugGSM8K (Li et al., 2024a), an
Findings After stage 2, code performance improved                     augmented version of the GSM8K benchmark’s training
across most languages, validating the decision to upsample            set, which has become a common component of recent pre-
StarCoderData. OWM integration had no significant im-                 training datasets (Achiam et al., 2023; Dubey et al., 2024;
pact on math performance, underscoring the need for larger,           Ai2, 2024). Overall, mathematical content totaled 14% of
higher-quality math datasets in later stages. Beyond code             the mixture. We expanded Stack-Edu to include additional
and math performance, as shown in Figure 6 (Appendix E.2),            programming languages not covered in stage 3, and set the
we observed above-random (>25%) MMLU accuracy with a                  dataset’s contribution to 24% of the mixture. We maintained
multiple-choice formulation (MCF, i.e. explicitly outputting          the natural distribution across programming languages, with
an option from ’A’, ’B’, ’C’, or ’D’ instead of computing             a higher allocation for Python. The remaining mixture con-
the likelihood of different answers as in the cloze formula-          sisted of English web data at 58% (maintaining the higher
tion). This contrasts prior work showing that small models            DCLM to FineWeb-Edu ratio) and Cosmopedia v2 (Allal
struggle with the MCF (Gu et al., 2024; Du et al., 2024)              et al., 2024) at 4%, which provides 30B tokens of high-
and suggests that long trainings of small models can make             quality synthetic textbooks, blog posts, and stories.
them acquire abilities typically associated with larger mod-
els (Blakeney et al., 2024; Gu et al., 2024; Du et al., 2024).
To further optimize MMLU performance, we revisited our                Findings While all benchmark tasks show improvements
English dataset mixture with additional annealing ablations           after stage 4, we observe substantial gains in coding perfor-
and found that increasing DCLM relative to FineWeb-Edu                mance and, most notably, in math performance, validating
slightly improves MMLU MCF at this stage.                             our data mixture specifically targeting these domains.

4.4. Stable phase: stage 3                                            4.6. Context Length extension

Data mixture In the third and last stage of the stable phase          To support long-context applications, we followed standard
(8T to 10T tokens, before annealing starts), we added the             practice (Gao et al., 2024) and extended the context length
text-only English portion of InfiMM-WebMath with OWM,                 from 2k to 8k tokens, by taking an intermediate checkpoint
bringing the total proportion of math data to approximately           from stage 4 (before the final 75 billion tokens of training)
10%, as shown in Figure 2. For English web data, we revis-            and continuing training with a different data mixture and a
ited our ablation findings and adjusted the FineWeb-Edu to            RoPE value of 130k. The mixture was adjusted to include
DCLM ratio to 40/60. For code, we replaced StarCoderData              40% long-context documents (8k tokens or more) sourced
with Stack-Edu (Section 3.4). For languages with fewer                from DCLM (10%), FineWeb-Edu (10%), and the books
than 4B tokens in Stack-Edu (TypeScript, Shell, Swift, Go,            subset of Dolma (20%) (Soldaini et al., 2024), while the
Rust and Ruby), we used their StarCoder2Data subsets. We              remaining 60% followed the stage 4 mixture. After this step,
                                                                      we obtain the final SmolLM2 base model.
                                                                  6
                                                             SmolLM2

                                                                      5.1. SmolTalk
Table 4. Performance comparison of SmolLM2 and other 1-2B
base models across benchmarks. SmolLM2 demonstrates compet-           Although the SmolLM2 base model outperformed other
itive results highlighting its generalization capabilities.           state-of-the-art base models in the 1-2B parameter range,
                                                                      the base model’s performance after fine-tuning on public
 Model family                   SmolLM2   Llama3.2   Qwen2.5
                                                                      datasets like MagPie-Pro (Xu et al., 2024) or OpenHer-
 Parameters                       1.7B       1B       1.5B
                                                                      mes2.5 (Teknium, 2023b) was lower than the post-trained
 HellaSwag                        68.7      61.2      66.4
 ARC                              60.5      49.2      58.5
                                                                      versions of these other models. This observation moti-
 PIQA                             77.6      74.8      76.1            vated the development of SmolTalk2 , a new instruction-
 CommonsenseQA                    43.6      41.2      34.1            following dataset that carefully combines selected existing
 Winogrande                       59.4      57.8      59.3            datasets with new synthetic datasets we developed, includ-
 OpenBookQA                       42.2      38.4      40.0
                                                                      ing the Magpie-Ultra conversational dataset as well as other
 MMLU-Pro (held-out)              19.4      11.7      13.7            specialized datasets that address specific capabilities like
 Natural Questions (held-out)      8.7       6.2      10.5
                                                                      Smol-Constraint, Smol-Rewrite, and Smol-Summarization.
 TriviaQA (held-out)              36.7      28.1      20.9
                                                                      All datasets were generated using Distilabel (Bartolomé
 GSM8K (5-shot)                   31.1      7.6       61.7
 MATH (4-shot)                    11.6       3.3      34.3
                                                                      Del Canto et al., 2024).
 HumanEval                        22.6      18.9      37.2
                                                                      5.1.1. C ONVERSATIONAL DATA
                                                                      MagPie-Ultra is a multi-turn dataset created using the two-
                                                                      step prompting method from (Xu et al., 2024). Unlike
                                                                      MagPie, which used Llama-3-70B-Instruct without specific
4.7. Base model evaluation                                            system prompts to generate two-turn conversations, MagPie-
We evaluate and compare the final base SmolLM2                        Ultra leverages the larger, more powerful model Llama-3.1-
model with existing state-of-the-art models of similar                405B-Instruct-FP8 (Dubey et al., 2024). We also incorporate
size, Qwen2.5-1.5B (Yang et al., 2024b) and Llama3.2-                 system prompts to guide generation, producing a balanced
1B (AI@Meta, 2024a), on a wide range of benchmarks.                   dataset of 1M samples with three-turn conversations. The
Evaluations are conducted using lighteval and in a zero-              resulting dataset was further filtered using smaller Llama
shot setting unless otherwise specified.                              models (Llama-3.1-8B-Instruct and Llama-Guard-3-8B) to
                                                                      ensure quality and safety of the generated instructions. We
Evaluation results in Table 4 show the strong performance             also leveraged ArmoRM (Wang et al., 2024b;a) to score
of base SmolLM2, outperforming the Qwen2.5 base model                 conversations for quality-based filtering, and gte-large-en-
on HellaSwag, and ARC. SmolLM2 also delivers strong                   v1.5 (Zhang et al., 2024; Li et al., 2023c) to deduplicate
performance on held-out benchmarks not monitored dur-                 semantically similar conversations.
ing training, such as MMLU-Pro (Wang et al., 2024c),
TriviaQA (Joshi et al., 2017), and Natural Questions (NQ,             We compare MagPie-Ultra to existing public supervised
Kwiatkowski et al., 2019). Notably, the model outperforms             fine-tuning (SFT) datasets in Table 10 (Appendix F). The
Qwen2.5-1.5B by nearly 6 percentage points on MMLU-                   evaluation suite included the instruction-following and con-
Pro, further validating its generalization capabilities. On           versation benchmarks IFEval (Zhou et al., 2023) and MT-
math and coding benchmarks, SmolLM2 demonstrates com-                 Bench (Zheng et al., 2023); reasoning in ARC Challenge;
petitive performance. While it lags behind Qwen2.5-1.5B,              knowledge in MMLU-Pro as well as GSM8K and MATH
SmolLM2 outperforms Llama3.2-1B on GSM8K, MATH                        for math evaluations. Our dataset outperforms MagPie-Pro
and HumanEval. Importantly, we see next to no degradation             on most benchmarks, and largely surpasses OpenHermes2.5
in performance after Context Length Extension, while the              and UltraChat (Ding et al., 2023) on IFEval and MT-Bench.
HELMET (Yen et al., 2024) and Needle in the Haystack
(NIAH) (Kamradt, 2024) results show strong performance –              5.1.2. TASK - SPECIFIC DATA
see Appendix G. These results highlight the effectiveness             We developed additional task-specific datasets to further en-
of our curated datasets, data mixtures, and training stages.          hance model instruction-following with detailed constraints
                                                                      (Smol-Constraint), summarization (Smol-Summarization)
5. Post-training                                                      and rewriting (Smol-Rewrite) capabilities. Smol-Constraint
After training the base SmolLM2 model, we followed cur-               contains 36k instructions with detailed constraints similar
rent standard practice for maximizing performance and util-           to the ones found in IFEval (Zhou et al., 2023). Using the
ity via post-training through instruction tuning and pref-            method from (Xu et al., 2024) with a targeted system prompt,
erence learning. For post-training, we leveraged existing
                                                                         2
datasets in addition to a new instruction tuning dataset called              https://huggingface.co/datasets/HuggingFaceTB/smoltalk
SmolTalk.

                                                                  7
                                                        SmolLM2

we generated 550k instructions and responses for these in-
                                                                   Table 5. Comparison of 1-2B instruction-tuned models across
structions using Qwen2.5-72B-Instruct (Yang et al., 2024b).
                                                                   benchmarks. SmolLM2-1.7B-Instruct exhibits strong performance
We then filtered out generated instructions that contained         in instruction-following, reasoning, and math.
conflicting constraints or incorrect responses, resulting in
56.3k instruction-response pairs, which after decontaminat-         Model              SmolLM2-1.7B   Llama3.2-1B   Qwen2.5-1.5B
ing against IFEval (10 n-gram overlap), yielded 36k pairs.          IFEval (Average)       56.7          53.5           47.4
                                                                    MT-Bench               6.13          5.48           6.52
For Smol-Summarization and Smol-Rewrite, we first gener-            OpenRewrite-Eval       44.9          39.2           46.9
ated high-quality source texts that would serve as the basis        ARC                    51.7          41.6           46.2
for summarization and rewriting tasks. We synthesized a             BBH (3-shot)           32.2          27.6           35.3
                                                                    MMLU-Pro               19.3          12.7           24.2
diverse collection of emails, tweets, LinkedIn posts, and
                                                                    HellaSwag              66.1          56.1           60.9
notes using PersonaHub (Ge et al., 2024) and personas from          PIQA                   74.4          72.3           73.2
the FinePersonas dataset (Argilla, 2024; Chan et al., 2024).        GSM8K (5-shot)         48.8          37.4           63.3
This allowed us to generate diverse content by prompting            MATH (4-shot)          21.0          19.5           19.6
Qwen2.5-72B-Instruct with specific system prompts and a             HumanEval              28.1          33.5           30.5
persona description, obtaining texts with various writing
styles, topics and perspectives. We then prompted Qwen2.5-
72B-Instruct to summarize and rewrite the given texts, ob-
taining around 1M summaries and 600k rewritten texts.
Adding the 3 Smol- datasets to MagPie-Ultra, (MagPie-              5.2. Supervised fine-tuning (SFT)
Ultra+) further improves IFEval performance as shown in            Table 9 (Appendix F) shows the final composition of
Table 10 (Appendix F).                                             SmolTalk. We performed supervised fine-tuning of our
                                                                   base SmolLM2 on SmolTalk for 2 epochs, using a global
5.1.3. M ATH DATA                                                  batch size of 128, sequence length of 8192, and a learning
To improve mathematical reasoning, we evaluated pub-               rate of 3.0 × 10−4 . The evaluation results after this SFT
lic math instruction datasets by fine-tuning on mixtures           phase are available in Table 10 (Appendix F).
with 80% general instruction data (MagPie Ultra + Smol-
Constraint, Smol-Rewrite, Smol-Summarization) and 20%              5.3. Alignment
math data from various sources. Results in Table 10                For preference learning, we used Direct Preference Opti-
(Appendix F) highlight complementary dataset strengths:            mization (DPO) (Rafailov et al., 2024). We experimented
NuminaMath-CoT (Li et al., 2024b) demonstrated strong              with various public synthetic feedback datasets (Ivison et al.,
performance on MATH and MT-Bench, while Meta-                      2024) including UltraFeedback (Cui et al., 2024), UltraInter-
MathQA (Yu et al., 2023), which is also included in Open-          act (Yuan et al., 2024), Capybara (Daniele & Suphavadeep-
Hermes2.5, improved results on GSM8K. Based on these               rasit, 2023), and ORCA (Lv et al., 2023). UltraFeedback
findings, we incorporated a combination of both datasets           proved the most consistently effective across benchmarks,
into SmolTalk.                                                     improving MT-Bench, MMLU-Pro, and MATH. We trained
                                                                   for 2 epochs with a learning rate of 1.0 × 10−6 , beta of
5.1.4. OTHER SPECIALIZED DATA
                                                                   0.5, global batch size of 128, and sequence length of 1024
For code generation, we used Self-OSS-Starcoder2-                  tokens. After this final stage of DPO training, we obtain the
Instruct (Wei et al., 2024a), containing 50k high-quality          instruct SmolLM2 model. As noted in Dubey et al. (2024),
Python instruction-response pairs. To support system               using short-context data for DPO did not impact the model’s
prompts, we included 30k randomly selected samples from            8k context ability.
SystemChats2.0 (Computations, 2024), and for function
calling, we added 80k samples from APIGen-Function-                5.4. Instruct model evaluation
Calling (Liu et al., 2024). Additionally, to maintain strong
                                                                   We evaluate the final instruct version of SmolLM2 and
performance on long-context tasks, we incorporated an En-
                                                                   compare it with the instruct variants of Qwen2.5-1.5B and
glish subset of LongAlign (Bai et al., 2024) (3.7k samples
                                                                   Llama3.2-1B, with results shown in Table 5. SmolLM2-
with 8k–16k tokens). We also added 100k randomly selected
                                                                   Instruct shows strong instruction following capabilities,
OpenHermes2.5 samples due to its strong performance in
                                                                   strongly outperforming Qwen2.5-1.5B-Instruct on IFEval;
knowledge (MMLU-Pro), Everyday-Conversations (Face,
                                                                   our model is competitive on MT-Bench and OpenRewrite-
2024), 2.2k casual multi-turn interactions, and Explore-
                                                                   Eval (Shu et al., 2024) for text rewriting, and demon-
Instruct (Wan et al., 2023) for rewriting. We found that
                                                                   strates strong mathematical capabilities as evidenced by
incorporating these datasets with the specified number of
                                                                   the GSM8K and MATH scores. These results highlight
samples effectively enhanced their target capabilities while
                                                                   SmolLM2’s ability to generalize across a variety of tasks,
preserving strong performance across other benchmarks.
                                                                   showcasing its potential as a capable chat assistant.

                                                               8
                                                           SmolLM2

6. SmolLM2 135M and 360M                                                • We thank Nouamane Tazi, Phuc Nguyen, Ferdinand
                                                                          Mom, and Haojun Zhao for designing and building our
In addition to SmolLM2-1.7B, we also trained two smaller                  training framework, Nanotron.
models: SmolLM2-360M (360M parameters, trained on 4T
tokens) and SmolLM2-135M (135M parameters, trained                      • We thank Guilherme Penedo and Hynek Kydlíček for
on 2T tokens), which are similarly state-of-the-art in their              building our data pipeline framework, Datatrove.
size class. Given their smaller capacity and reduced training
cost, we re-ran data ablations at the target training length to         • We thank Clémentine Fourrier and Nathan Habib for
determine the most effective data mixture. We found that                  developing our evaluation framework, LightEval.
filtering DCLM with the FineWeb-Edu classifier, remov-
                                                                        • We thank all our colleagues who participated in discus-
ing samples with score 0, and downsampling those with
                                                                          sions that contributed to the development and refine-
scores 1 and 2 worked best. Unlike SmolLM2-1.7B, where
                                                                          ment of SmolLM2.
we leveraged a multi-stage training strategy, these smaller
models benefited from a single-stage training approach with             • We thank Muhammed Emin Baslak and Pierre-Carl
consistently high-quality data. We incorporated Stack-Edu                 Langlais for their work on enhancing SmolLM2 with
from the start, alongside InfiMM-WebMath, FineMath, and                   Entropix.
Cosmopedia. These models share the same architecture as
SmolLM2-1.7B but use Grouped Query Attention (GQA)                    We also extend our gratitude to the broader research commu-
and were trained using the WSD scheduler with 20% de-                 nity and open-source ecosystem for fostering collaboration
cay and a learning rate of 3.0 × 10−3 . For post-training,            and innovation, without which this project would not have
we applied SFT using a filtered version of SmolTalk3 , re-            been possible.
moving complex instruction-following tasks (e.g., function
calling) and hard examples from MagPie-Ultra to better
align with the models’ capacity. Finally, we performed                Impact Statement
DPO training using UltraFeedback, optimizing the models               This paper presents work whose goal is to advance the field
for instruction-following while preserving coherence and              of Machine Learning. There are many potential societal
helpfulness. More details about SmolLM2-360M and 135M                 consequences of our work, none which we feel must be
can be found in their respective model cards45 .                      specifically highlighted here.

7. Conclusion
                                                                      References
SmolLM2 advances the state-of-the-art for open small LMs
                                                                      Claudebot documentation. https://darkvisitors.
through a combination of careful dataset curation and multi-
                                                                        com/agents/claudebot. Accessed: 2024-06-05.
stage training. Our approach highlights the critical role
of high-quality, specialized datasets in enabling smaller             Common crawl. https://commoncrawl.org/. Ac-
models to achieve strong performance across a variety                   cessed: 2024-06-05.
of benchmarks. The development of FineMath, Stack-
Edu, and SmolTalk addressed limitations in existing public            Openai gptbot documentation. https://platform.
datasets, improving capabilities in reasoning, mathemat-                openai.com/docs/gptbot. Accessed: 2024-06-
ics, and instruction-following tasks. To support future re-             05.
search and development, we release SmolLM2 alongside
the datasets and code used in its training. These resources           Abdin, M., Aneja, J., Awadalla, H., Awadallah, A., Awan,
provide a comprehensive foundation for training performant             A. A., Bach, N., Bahree, A., Bakhtiari, A., Bao, J., Behl,
small language models, making them accessible to a broader              H., et al. Phi-3 technical report: A highly capable lan-
range of researchers and applications.                                  guage model locally on your phone. arXiv preprint
                                                                        arXiv:2404.14219, 2024a.

Acknowledgments                                                       Abdin, M., Aneja, J., Behl, H., Bubeck, S., Eldan, R.,
                                                                        Gunasekar, S., Harrison, M., Hewett, R. J., Javaheripi,
This work would not have been possible without the contri-              M., Kauffmann, P., et al. Phi-4 technical report. arXiv
butions and support of our collaborators and colleagues:                preprint arXiv:2412.08905, 2024b.
   3
    https://huggingface.co/datasets/HuggingFaceTB/smol-
                                                                      Achiam, J., Adler, S., Agarwal, S., Ahmad, L., Akkaya, I.,
smoltalk
  4
    SmolLM2-360M model card                                             Aleman, F. L., Almeida, D., Altenschmidt, J., Altman, S.,
  5
    SmolLM2-135M model card                                             Anadkat, S., et al. Gpt-4 technical report. arXiv preprint
                                                                        arXiv:2303.08774, 2023.

                                                                  9
                                                          SmolLM2

Ai2. Olmo 2: The best fully open language model                       Bisk, Y., Zellers, R., Bras, R. L., Gao, J., and Choi, Y.
  to date. https://allenai.org/blog/olmo2,                              Piqa: Reasoning about physical commonsense in natural
  2024. Blog post.                                                      language, 2019.

AI@Meta.    Llama 3.2: Revolutionizing edge ai Blakeney, C., Paul, M., Larsen, B. W., Owen, S., and Fran-
  and vision with open, customizable models,     kle, J. Does your data spark joy? performance gains from
  2024a.   URL https://ai.meta.com/blog/         domain upsampling at the end of training. arXiv preprint
                                                 arXiv:2406.03476, 2024.
  llama-3-2-connect-2024-vision-edge-mobile-devices/.

AI@Meta.  Llama 3.2 model card, 2024b. URL                            Broder, A. Z. On the resemblance and containment of
  https://github.com/meta-llama/                                        documents. Proceedings. Compression and Complexity
  llama-models/blob/main/models/llama3_                                 of SEQUENCES 1997 (Cat. No.97TB100171), pp. 21–29,
  2/MODEL_CARD.md.                                                      1997.

Allal, L. B., Lozhkov, A., Bakouch, E., von Werra, L., and            Brown, T., Mann, B., Ryder, N., Subbiah, M., Kaplan, J.,
  Wolf, T. Smollm - blazingly fast and remarkably powerful,             Dhariwal, P., Neelakantan, A., Shyam, P., Sastry, G.,
  2024.                                                                 Askell, A., et al. Language models are few-shot learners.
                                                                        arXiv preprint arXiv:2005.14165, 2020.
Almazrouei, E., Alobeidli, H., Alshamsi, A., Cappelli, A.,
  Cojocaru, R., Debbah, M., Goffinet, É., Hesslow, D., Lau-           Cassano, F., Gouwar, J., Nguyen, D., Nguyen, S., Phipps-
  nay, J., Malartic, Q., et al. The falcon series of open lan-          Costin, L., Pinckney, D., Yee, M.-H., Zi, Y., Anderson,
  guage models. arXiv preprint arXiv:2311.16867, 2023.                  C. J., Feldman, M. Q., et al. Multipl-e: A scalable and
                                                                        extensible approach to benchmarking neural code genera-
Argilla.     Finepersonas-v0.1 dataset. https:                          tion. arXiv preprint arXiv:2208.08227, 2022.
  //huggingface.co/datasets/argilla/
  FinePersonas-v0.1, 2024. Available on Hugging                       Chan, X., Wang, X., Yu, D., Mi, H., and Yu, D. Scaling syn-
  Face Datasets.                                                        thetic data creation with 1,000,000,000 personas, 2024.
                                                                        URL https://arxiv.org/abs/2406.20094.
Aryabumi, V., Su, Y., Ma, R., Morisot, A., Zhang, I., Lo-
  catelli, A., Fadaee, M., Üstün, A., and Hooker, S. To code,         Chen, M., Tworek, J., Jun, H., Yuan, Q., Pinto, H. P. D. O.,
  or not to code? exploring impact of code in pre-training.             Kaplan, J., Edwards, H., Burda, Y., Joseph, N., Brockman,
  arXiv preprint arXiv:2408.10914, 2024.                                G., et al. Evaluating large language models trained on
                                                                        code. arXiv preprint arXiv:2107.03374, 2021.
Azerbayev, Z., Schoelkopf, H., Paster, K., Santos, M. D.,
  McAleer, S., Jiang, A. Q., Deng, J., Biderman, S., and              Chowdhery, A., Narang, S., Devlin, J., Bosma, M., Mishra,
 Welleck, S. Llemma: An open language model for math-                   G., Roberts, A., Barham, P., Chung, H. W., Sutton, C.,
  ematics. arXiv preprint arXiv:2310.10631, 2023.                       Gehrmann, S., et al. Palm: Scaling language modeling
                                                                        with pathways. Journal of Machine Learning Research,
Bai, J., Bai, S., Chu, Y., Cui, Z., Dang, K., Deng, X., Fan,            24(240):1–113, 2023.
  Y., Ge, W., Han, Y., Huang, F., et al. Qwen technical
  report. arXiv preprint arXiv:2309.16609, 2023.                      Clark, K. What does bert look at? an analysis of bert’s
                                                                        attention. arXiv preprint arXiv:1906.04341, 2019.
Bai, Y., Kadavath, S., Kundu, S., Askell, A., Kernion, J.,
  Jones, A., Chen, A., Goldie, A., Mirhoseini, A., McKin-             Clark, P., Cowhey, I., Etzioni, O., Khot, T., Sabharwal, A.,
  non, C., et al. Constitutional ai: Harmlessness from ai               Schoenick, C., and Tafjord, O. Think you have solved
  feedback. arXiv preprint arXiv:2212.08073, 2022.                      question answering? try arc, the ai2 reasoning challenge,
                                                                        2018.
Bai, Y., Lv, X., Zhang, J., He, Y., Qi, J., Hou, L., Tang, J.,
  Dong, Y., and Li, J. Longalign: A recipe for long con-              Cobbe, K., Kosaraju, V., Bavarian, M., Chen, M., Jun, H.,
  text alignment of large language models. arXiv preprint               Kaiser, L., Plappert, M., Tworek, J., Hilton, J., Nakano,
  arXiv:2401.18058, 2024.                                               R., et al. Training verifiers to solve math word problems.
                                                                        arXiv preprint arXiv:2110.14168, 2021.
Bartolomé Del Canto, Á., Martín Blázquez, G., Piqueres La-
  jarín, A., and Vila Suero, D. Distilabel: An AI feed-               Computations, C.   Systemchat-2.0. https:
  back (AIF) framework for building datasets with and                   //huggingface.co/datasets/
  for LLMs. https://github.com/argilla-io/                              cognitivecomputations/SystemChat-2.0,
  distilabel, 2024.                                                     2024.

                                                                 10
                                                          SmolLM2

Cui, G., Yuan, L., Ding, N., Yao, G., He, B., Zhu, W., Ni, Y.,        Gunter, T., Wang, Z., Wang, C., Pang, R., Narayanan, A.,
  Xie, G., Xie, R., Lin, Y., et al. Ultrafeedback: Boosting             Zhang, A., Zhang, B., Chen, C., Chiu, C.-C., Qiu, D.,
  language models with scaled ai feedback. In Forty-first               et al. Apple intelligence foundation language models.
  International Conference on Machine Learning, 2024.                   arXiv preprint arXiv:2407.21075, 2024.

Daniele, L. and Suphavadeeprasit. Amplify-instruct: Syn-              Hägele, A., Bakouch, E., Kosson, A., Allal, L. B.,
  thetically generated diverse multi-turn conversations for             Von Werra, L., and Jaggi, M. Scaling laws and compute-
  efficient llm training. arXiv preprint arXiv:(coming                  optimal training beyond fixed training durations. arXiv
  soon), 2023. URL https://huggingface.co/                              preprint arXiv:2405.18392, 2024.
  datasets/LDJnr/Capybara.
                                                                      Han, X., Jian, Y., Hu, X., Liu, H., Wang, Y., Fan, Q., Ai, Y.,
de     Vries, H.      Go smol or go home.                               Huang, H., He, R., Yang, Z., et al. Infimm-webmath-40b:
     https://www.harmdevries.com/post/                                  Advancing multimodal pre-training for enhanced math-
     model-size-vs-compute-overhead/, 2023.                             ematical reasoning. arXiv preprint arXiv:2409.12568,
                                                                        2024.
Ding, N., Chen, Y., Xu, B., Qin, Y., Zheng, Z., Hu, S., Liu,
  Z., Sun, M., and Zhou, B. Enhancing chat language mod-              Hendrycks, D., Burns, C., Basart, S., Zou, A., Mazeika, M.,
  els by scaling high-quality instructional conversations.              Song, D., and Steinhardt, J. Measuring massive multitask
  arXiv preprint arXiv:2305.14233, 2023.                                language understanding, 2021.

Du, Z., Zeng, A., Dong, Y., and Tang, J. Understanding                Hoffmann, J., Borgeaud, S., Mensch, A., Buchatskaya, E.,
  emergent abilities of language models from the loss per-              Cai, T., Rutherford, E., Casas, D. d. L., Hendricks, L. A.,
  spective. arXiv preprint arXiv:2403.15796, 2024.                     Welbl, J., Clark, A., et al. Training compute-optimal
                                                                        large language models. arXiv preprint arXiv:2203.15556,
Dua, D., Wang, Y., Dasigi, P., Stanovsky, G., Singh, S.,                2022.
  and Gardner, M. Drop: A reading comprehension bench-
  mark requiring discrete reasoning over paragraphs. arXiv            Hu, S., Tu, Y., Han, X., He, C., Cui, G., Long, X., Zheng,
  preprint arXiv:1903.00161, 2019.                                      Z., Fang, Y., Huang, Y., Zhao, W., Zhang, X., Thai, Z. L.,
                                                                        Zhang, K., Wang, C., Yao, Y., Zhao, C., Zhou, J., Cai,
Dubey, A., Jauhri, A., Pandey, A., Kadian, A., Al-Dahle,               J., Zhai, Z., Ding, N., Jia, C., Zeng, G., Li, D., Liu, Z.,
 A., Letman, A., Mathur, A., Schelten, A., Yang, A., Fan,               and Sun, M. Minicpm: Unveiling the potential of small
 A., et al. The llama 3 herd of models. arXiv preprint                  language models with scalable training strategies, 2024.
  arXiv:2407.21783, 2024.                                               URL https://arxiv.org/abs/2404.06395.

Face,   H.       Everyday  conversations for                          Ivison, H., Wang, Y., Liu, J., Wu, Z., Pyatkin, V., Lam-
  llms.               https://huggingface.                               bert, N., Smith, N. A., Choi, Y., and Hajishirzi, H.
  co/datasets/HuggingFaceTB/                                             Unpacking dpo and ppo: Disentangling best practices
  everyday-conversations-llama3.1-2k,                                    for learning from preference feedback. arXiv preprint
  2024.                                                                  arXiv:2406.09279, 2024.

Gao, T., Wettig, A., Yen, H., and Chen, D. How to train               Joshi, M., Choi, E., Weld, D. S., and Zettlemoyer, L.
  long-context language models (effectively), 2024. URL                 Triviaqa: A large scale distantly supervised challenge
  https://arxiv.org/abs/2410.02660.                                     dataset for reading comprehension. arXiv preprint
                                                                        arXiv:1705.03551, 2017.
Ge, T., Chan, X., Wang, X., Yu, D., Mi, H., and Yu, D. Scal-
  ing synthetic data creation with 1,000,000,000 personas.            Joulin, A., Grave, E., Bojanowski, P., Douze, M., Jégou, H.,
  arXiv preprint arXiv:2406.20094, 2024.                                and Mikolov, T. Fasttext.zip: Compressing text classifi-
                                                                        cation models. arXiv preprint arXiv:1612.03651, 2016a.
Groeneveld, D., Beltagy, I., Walsh, P., Bhagia, A., Kinney,
  R., Tafjord, O., Jha, A. H., Ivison, H., Magnusson, I.,             Joulin, A., Grave, E., Bojanowski, P., and Mikolov, T. Bag
  Wang, Y., et al. Olmo: Accelerating the science of lan-               of tricks for efficient text classification. arXiv preprint
  guage models. arXiv preprint arXiv:2402.00838, 2024.                  arXiv:1607.01759, 2016b.

Gu, Y., Tafjord, O., Kuehl, B., Haddad, D., Dodge, J., and            Kamradt, G. Needle in a haystack - pressure test-
  Hajishirzi, H. Olmes: A standard for language model                   ing llms. https://github.com/gkamradt/
  evaluations. arXiv preprint arXiv:2406.08446, 2024.                   LLMTestNeedleInAHaystack, 2024.

                                                                 11
                                                           SmolLM2

Kocetkov, D., Li, R., Allal, L. B., Li, J., Mou, C., Ferrandis,        Li, Y., Bubeck, S., Eldan, R., Del Giorno, A., Gunasekar,
  C. M., Jernite, Y., Mitchell, M., Hughes, S., Wolf, T.,                S., and Lee, Y. T. Textbooks are all you need ii: phi-
  et al. The stack: 3 tb of permissively licensed source                 1.5 technical report. arXiv preprint arXiv:2309.05463,
  code. arXiv preprint arXiv:2211.15533, 2022.                           2023b.

Kong, X., Gunter, T., and Pang, R.           Large language            Li, Z., Zhang, X., Zhang, Y., Long, D., Xie, P., and Zhang,
  model-guided document selection.            arXiv preprint             M. Towards general text embeddings with multi-stage
  arXiv:2406.04638, 2024.                                                contrastive learning. arXiv preprint arXiv:2308.03281,
                                                                         2023c.
Kwiatkowski, T., Palomaki, J., Redfield, O., Collins, M.,
                                                                       Liu, Z., Hoang, T., Zhang, J., Zhu, M., Lan, T., Kokane,
 Parikh, A., Alberti, C., Epstein, D., Polosukhin, I., Devlin,
                                                                         S., Tan, J., Yao, W., Liu, Z., Feng, Y., et al. Api-
 J., Lee, K., et al. Natural questions: a benchmark for ques-
                                                                         gen: Automated pipeline for generating verifiable
 tion answering research. Transactions of the Association
                                                                         and diverse function-calling datasets. arXiv preprint
 for Computational Linguistics, 7, 2019.
                                                                         arXiv:2406.18518, 2024.
Lee, H., Phatale, S., Mansoor, H., Mesnard, T., Ferret, J.,            Loshchilov, I. and Hutter, F. SGDR: Stochastic gra-
  Lu, K. R., Bishop, C., Hall, E., Carbune, V., Rastogi,                 dient descent with warm restarts. arXiv preprint
  A., et al. Rlaif vs. rlhf: Scaling reinforcement learning              arXiv:1608.03983, 2016.
  from human feedback with ai feedback. In Forty-first
  International Conference on Machine Learning.                        Lozhkov, A., Li, R., Allal, L. B., Cassano, F., Lamy-Poirier,
                                                                         J., Tazi, N., Tang, A., Pykhtar, D., Liu, J., Wei, Y., et al.
Lewkowycz, A., Andreassen, A., Dohan, D., Dyer, E.,                      Starcoder 2 and the stack v2: The next generation. arXiv
  Michalewski, H., Ramasesh, V., Slone, A., Anil, C.,                    preprint arXiv:2402.19173, 2024.
  Schlag, I., Gutman-Solo, T., et al. Solving quantitative
  reasoning problems with language models. Advances in                 Lv, K., Zhang, W., and Shen, H.       Supervised
  Neural Information Processing Systems, 35:3843–3857,                   fine-tuning and direct preference optimization
  2022.                                                                  on intel gaudi2.         https://medium.com/
                                                                         intel-analytics-software/a1197d8a3cd3,
Li, C., Yuan, Z., Yuan, H., Dong, G., Lu, K., Wu, J., Tan,               2023. Intel Corporation.
  C., Wang, X., and Zhou, C. Mugglemath: Assessing                     Mihaylov, T., Clark, P., Khot, T., and Sabharwal, A. Can a
  the impact of query and response augmentation on math                 suit of armor conduct electricity? a new dataset for open
  reasoning. In Proceedings of the 62nd Annual Meeting of               book question answering. In EMNLP, 2018.
  the Association for Computational Linguistics (Volume 1:
  Long Papers), pp. 10230–10258, 2024a.                                Mishra, S., Khashabi, D., Baral, C., and Hajishirzi, H. Cross-
                                                                        task generalization via natural language crowdsourcing
Li, J., Beeching, E., Tunstall, L., Lipkin, B., So-                     instructions. arXiv preprint arXiv:2104.08773, 2021.
  letskyi, R., Huang, S. C., Rasul, K., Yu, L.,
  Jiang, A., Shen, Z., Qin, Z., Dong, B., Zhou, L.,                    MosaicML. Llm foundry - jeopardy dataset, 2024.
  Fleureau, Y., Lample, G., and Polu, S. Numina-                        URL       https://github.com/mosaicml/
  math.      [https://huggingface.co/AI-MO/                             llm-foundry/blob/main/scripts/eval/
  NuminaMath-CoT](https://github.com/                                   local_data/world_knowledge/jeopardy_
  project-numina/aimo-progress-prize/                                   all.jsonl. Accessed: 2024-11-10.
  blob/main/report/numina_dataset.pdf),
                                                                       Muennighoff, N., Rush, A. M., Barak, B., Scao, T. L., Piktus,
  2024b.
                                                                        A., Tazi, N., Pyysalo, S., Wolf, T., and Raffel, C. Scaling
                                                                        data-constrained language models, 2023.
Li, J., Fang, A., Smyrnis, G., Ivgi, M., Jordan, M., Gadre, S.,
   Bansal, H., Guha, E., Keh, S., Arora, K., et al. Datacomp-          Ouyang, L., Wu, J., Jiang, X., Almeida, D., Wainwright, C.,
   LM: In search of the next generation of training sets                 Mishkin, P., Zhang, C., Agarwal, S., Slama, K., Ray, A.,
   for language models. arXiv preprint arXiv:2406.11794,                 et al. Training language models to follow instructions
   2024c.                                                                with human feedback. Advances in neural information
                                                                         processing systems, 35:27730–27744, 2022.
Li, R., Allal, L. B., Zi, Y., Muennighoff, N., Kocetkov, D.,
  Mou, C., Marone, M., Akiki, C., Li, J., Chim, J., et al.             Paster, K., Santos, M. D., Azerbayev, Z., and Ba, J. Open-
  Starcoder: may the source be with you! arXiv preprint                  webmath: An open dataset of high-quality mathematical
  arXiv:2305.06161, 2023a.                                               web text. arXiv preprint arXiv:2310.06786, 2023.

                                                                  12
                                                            SmolLM2

Penedo, G., Kydlícek, H., Allal, L. B., Lozhkov, A.,                    Sanh, V., Webson, A., Raffel, C., Bach, S. H., Sutawika, L.,
  Mitchell, M., Raffel, C., von Werra, L., and Wolf,                      Alyafeai, Z., Chaffin, A., Stiegler, A., Scao, T. L., Raja,
  T. The fineweb datasets: Decanting the web for                          A., et al. Multitask prompted training enables zero-shot
  the finest text data at scale. ArXiv, abs/2406.17557,                   task generalization. arXiv preprint arXiv:2110.08207,
  2024a. URL https://api.semanticscholar.                                 2021.
  org/CorpusID:270711474.
                                                                        Shao, Z., Wang, P., Zhu, Q., Xu, R., Song, J., Bi, X., Zhang,
Penedo, G., Malartic, Q., Hesslow, D., Cojocaru, R., Alobei-              H., Zhang, M., Li, Y., Wu, Y., et al. Deepseekmath: Push-
  dli, H., Cappelli, A., Pannier, B., Almazrouei, E., and                 ing the limits of mathematical reasoning in open language
  Launay, J. The RefinedWeb dataset for Falcon LLM: Out-                  models. arXiv preprint arXiv:2402.03300, 2024.
  performing curated corpora with web data only. In Ad-
                                                                        Shu, L., Luo, L., Hoskere, J., Zhu, Y., Liu, Y., Tong, S.,
  vances in Neural Information Processing Systems, 2024b.
                                                                          Chen, J., and Meng, L. Rewritelm: An instruction-tuned
Petroni, F., Rocktäschel, T., Lewis, P., Bakhtin, A., Wu,                 large language model for text rewriting. In Proceedings
  Y., Miller, A. H., and Riedel, S. Language models as                    of the AAAI Conference on Artificial Intelligence, vol-
  knowledge bases? arXiv preprint arXiv:1909.01066,                       ume 38, pp. 18970–18980, 2024.
  2019.
                                                                        Singer, P., Pfeiffer, P., Babakhin, Y., Jeblick, M., Dhankhar,
Radford, A., Wu, J., Child, R., Luan, D., Amodei, D., and                 N., Fodor, G., and Ambati, S. S. H2o-danube-1.8 b
  Sutskever, I. Language models are unsupervised multitask                technical report. arXiv preprint arXiv:2401.16818, 2024.
  learners. 2019.
                                                                        Soboleva, D., Al-Khateeb, F., Myers, R., Steeves, J. R.,
Rafailov, R., Sharma, A., Mitchell, E., Manning, C. D., Er-               Hestness, J., and Dey, N. Slimpajama: A 627b to-
  mon, S., and Finn, C. Direct preference optimization:                   ken cleaned and deduplicated version of redpajama,
  Your language model is secretly a reward model. Ad-                     June 2023. URL https://huggingface.co/
  vances in Neural Information Processing Systems, 36,                    datasets/cerebras/SlimPajama-627B.
  2024.                                                                 Soldaini, L., Kinney, R., Bhagia, A., Schwenk, D., Atkinson,
Raffel, C., Shazeer, N., Roberts, A., Lee, K., Narang, S.,                D., Authur, R., Bogin, B., Chandu, K., Dumas, J., Elazar,
  Matena, M., Zhou, Y., Li, W., and Liu, P. J. Exploring                  Y., Hofmann, V., Jha, A. H., Kumar, S., Lucy, L., Lyu, X.,
  the limits of transfer learning with a unified text-to-text             Lambert, N., Magnusson, I., Morrison, J., Muennighoff,
  transformer. Journal of machine learning research, 21                   N., Naik, A., Nam, C., Peters, M. E., Ravichander, A.,
  (140):1–67, 2020.                                                       Richardson, K., Shen, Z., Strubell, E., Subramani, N.,
                                                                          Tafjord, O., Walsh, P., Zettlemoyer, L., Smith, N. A.,
Rajpurkar, P., Jia, R., and Liang, P. Know what you don’t                 Hajishirzi, H., Beltagy, I., Groeneveld, D., Dodge, J., and
  know: Unanswerable questions for squad. arXiv preprint                  Lo, K. Dolma: an open corpus of three trillion tokens for
  arXiv:1806.03822, 2018.                                                 language model pretraining research, 2024.
Reddy, S., Chen, D., and Manning, C. D. Coqa: A conversa-               Talmor, A., Herzig, J., Lourie, N., and Berant, J. Common-
  tional question answering challenge. Transactions of the                senseqa: A question answering challenge targeting com-
  Association for Computational Linguistics, 7:249–266,                   monsense knowledge. In Proceedings of the 2019 Confer-
  2019.                                                                   ence of the North American Chapter of the Association for
Roberts, A., Raffel, C., and Shazeer, N. How much knowl-                  Computational Linguistics: Human Language Technolo-
  edge can you pack into the parameters of a language                     gies, Volume 1 (Long and Short Papers), pp. 4149–4158,
  model? arXiv preprint arXiv:2002.08910, 2020.                           Minneapolis, Minnesota, June 2019. Association for
                                                                          Computational Linguistics. doi: 10.18653/v1/N19-1421.
Rolnick, D., Veit, A., Belongie, S., and Shavit, N. Deep                  URL https://aclanthology.org/N19-1421.
  learning is robust to massive label noise. arxiv 2017.
  arXiv preprint arXiv:1705.10694, 2017.                                Taylor, R., Kardas, M., Cucurull, G., Scialom, T., Hartshorn,
                                                                          A., Saravia, E., Poulton, A., Kerkez, V., and Stojnic, R.
Roziere, B., Gehring, J., Gloeckle, F., Sootla, S., Gat, I.,              Galactica: A large language model for science. arXiv
  Tan, X. E., Adi, Y., Liu, J., Sauvestre, R., Remez, T., et al.          preprint arXiv:2211.09085, 2022.
  Code llama: Open foundation models for code. arXiv
                                                                        Team, G., Riviere, M., Pathak, S., Sessa, P. G., Hardin,
  preprint arXiv:2308.12950, 2023.
                                                                          C., Bhupatiraju, S., Hussenot, L., Mesnard, T., Shahriari,
Sakaguchi, K., Bras, R. L., Bhagavatula, C., and Choi, Y.                 B., Ramé, A., et al. Gemma 2: Improving open lan-
  Winogrande: An adversarial winograd schema challenge                    guage models at a practical size, 2024. URL https://arxiv.
  at scale, 2019.                                                         org/abs/2408.00118, 1(3), 2024.

                                                                   13
                                                        SmolLM2

Teknium.     Openhermes 2.5: An open dataset of                       Selfcodealign: Self-alignment for code generation. arXiv
  synthetic data for generalist llm assistants, 2023a.                preprint arXiv:2410.24198, 2024a.
  URL https://huggingface.co/datasets/
  teknium/OpenHermes-2.5.                                           Wei, Y., Han, H., and Samdani, R. Arctic-snowcoder: De-
                                                                     mystifying high-quality data in code pretraining. arXiv
Teknium.     Openhermes 2.5: An open dataset of                      preprint arXiv:2409.02326, 2024b.
  synthetic data for generalist llm assistants, 2023b.
  URL https://huggingface.co/datasets/                              Xu, Z., Jiang, F., Niu, L., Deng, Y., Poovendran, R., Choi,
  teknium/OpenHermes-2.5.                                            Y., and Lin, B. Y. Magpie: Alignment data synthesis from
                                                                      scratch by prompting aligned llms with nothing. arXiv
Touvron, H., Lavril, T., Izacard, G., Martinet, X., Lachaux,          preprint arXiv:2406.08464, 2024.
  M.-A., Lacroix, T., Rozière, B., Goyal, N., Hambro, E.,
                                                                    Yang, A., Yang, B., Hui, B., Zheng, B., Yu, B., Zhou, C., Li,
  Azhar, F., Rodriguez, A., Joulin, A., Grave, E., and Lam-
                                                                      C., Li, C., Liu, D., Huang, F., Dong, G., Wei, H., Lin, H.,
  ple, G. Llama: Open and efficient foundation language
                                                                      Tang, J., Wang, J., Yang, J., Tu, J., Zhang, J., Ma, J., Xu,
  models, 2023.
                                                                      J., Zhou, J., Bai, J., He, J., Lin, J., Dang, K., Lu, K., Chen,
Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones,           K.-Y., Yang, K., Li, M., Xue, M., Ni, N., Zhang, P., Wang,
  L., Gomez, A. N., Kaiser, L. u., and Polosukhin, I. Atten-          P., Peng, R., Men, R., Gao, R., Lin, R., Wang, S., Bai, S.,
  tion is all you need. In Advances in Neural Information             Tan, S., Zhu, T., Li, T., Liu, T., Ge, W., Deng, X., Zhou,
  Processing Systems, 2017.                                           X., Ren, X., Zhang, X., Wei, X., Ren, X., Fan, Y., Yao, Y.,
                                                                      Zhang, Y., Wan, Y., Chu, Y., Cui, Z., Zhang, Z., and Fan,
Wan, F., Huang, X., Yang, T., Quan, X., Bi, W., and Shi,              Z.-W. Qwen2 technical report. ArXiv, abs/2407.10671,
 S. Explore-instruct: Enhancing domain-specific instruc-              2024a. URL https://api.semanticscholar.
 tion coverage through active exploration. arXiv preprint             org/CorpusID:271212307.
 arXiv:2310.09168, 2023.
                                                                    Yang, A., Yang, B., Zhang, B., Hui, B., Zheng, B., Yu, B., Li,
Wang, H., Lin, Y., Xiong, W., Yang, R., Diao, S., Qiu, S.,            C., Liu, D., Huang, F., Wei, H., et al. Qwen2. 5 technical
 Zhao, H., and Zhang, T. Arithmetic control of llms for di-           report. arXiv preprint arXiv:2412.15115, 2024b.
 verse user preferences: Directional preference alignment
 with multi-objective rewards. In ACL, 2024a.                       Yang, A., Zhang, B., Hui, B., Gao, B., Yu, B., Li, C., Liu,
                                                                      D., Tu, J., Zhou, J., Lin, J., et al. Qwen2.5-math techni-
Wang, H., Xiong, W., Xie, T., Zhao, H., and Zhang, T. Inter-          cal report: Toward mathematical expert model via self-
 pretable preferences via multi-objective reward modeling             improvement. arXiv preprint arXiv:2409.12122, 2024c.
 and mixture-of-experts. In EMNLP, 2024b.
                                                                    Yen, H., Gao, T., Hou, M., Ding, K., Fleischer, D., Izsak,
Wang, Y., Kordi, Y., Mishra, S., Liu, A., Smith, N. A.,               P., Wasserblat, M., and Chen, D. Helmet: How to
 Khashabi, D., and Hajishirzi, H. Self-instruct: Aligning             evaluate long-context language models effectively and
 language models with self-generated instructions. arXiv              thoroughly, 2024. URL https://arxiv.org/abs/
 preprint arXiv:2212.10560, 2022.                                     2410.02694.
Wang, Y., Ma, X., Zhang, G., Ni, Y., Chandra, A., Guo, S.,          Young, A., Chen, B., Li, C., Huang, C., Zhang, G.,
 Ren, W., Arulraj, A., He, X., Jiang, Z., et al. Mmlu-pro:            Zhang, G., Li, H., Zhu, J., Chen, J., Chang, J., et al.
 A more robust and challenging multi-task language under-             Yi: Open foundation models by 01.ai. arXiv preprint
 standing benchmark. arXiv preprint arXiv:2406.01574,                 arXiv:2403.04652, 2024.
 2024c.
                                                                    Yu, L., Jiang, W., Shi, H., Yu, J., Liu, Z., Zhang, Y., Kwok,
Wang, Z., Li, X., Xia, R., and Liu, P. Mathpile: A billion-           J. T., Li, Z., Weller, A., and Liu, W. Metamath: Boot-
 token-scale pretraining corpus for math. In The Thirty-              strap your own mathematical questions for large language
 eight Conference on Neural Information Processing Sys-               models. arXiv preprint arXiv:2309.12284, 2023.
 tems Datasets and Benchmarks Track.
                                                                    Yuan, L., Cui, G., Wang, H., Ding, N., Wang, X., Deng, J.,
Wei, J., Bosma, M., Zhao, V. Y., Guu, K., Yu, A. W., Lester,          Shan, B., Chen, H., Xie, R., Lin, Y., et al. Advancing
 B., Du, N., Dai, A. M., and Le, Q. V. Finetuned lan-                 llm reasoning generalists with preference trees. arXiv
 guage models are zero-shot learners. arXiv preprint                  preprint arXiv:2404.02078, 2024.
 arXiv:2109.01652, 2021.
                                                                    Zellers, R., Holtzman, A., Bisk, Y., Farhadi, A., and Choi,
Wei, Y., Cassano, F., Liu, J., Ding, Y., Jain, N., Mueller,           Y. Hellaswag: Can a machine really finish your sen-
 Z., de Vries, H., von Werra, L., Guha, A., and Zhang, L.             tence? In Korhonen, A., Traum, D., and Màrquez,

                                                               14
                                                           SmolLM2

  L. (eds.), Proceedings of the 57th Annual Meeting of
  the Association for Computational Linguistics, pp. 4791–
  4800, Florence, Italy, July 2019. Association for Compu-
  tational Linguistics. doi: 10.18653/v1/P19-1472. URL
  https://aclanthology.org/P19-1472.
Zhai, X., Kolesnikov, A., Houlsby, N., and Beyer, L. Scal-
  ing vision transformers, 2022. URL https://arxiv.
  org/abs/2106.04560.
Zhang, X., Zhang, Y., Long, D., Xie, W., Dai, Z., Tang,
  J., Lin, H., Yang, B., Xie, P., Huang, F., et al. mgte:
  Generalized long-context text representation and rerank-
  ing models for multilingual text retrieval. arXiv preprint
  arXiv:2407.19669, 2024.
Zheng, L., Chiang, W.-L., Sheng, Y., Zhuang, S., Wu, Z.,
  Zhuang, Y., Lin, Z., Li, Z., Li, D., Xing, E., et al. Judging
  llm-as-a-judge with mt-bench and chatbot arena. Ad-
  vances in Neural Information Processing Systems, 36:
  46595–46623, 2023.
Zhou, J., Lu, T., Mishra, S., Brahma, S., Basu, S.,
  Luan, Y., Zhou, D., and Hou, L. Instruction-following
  evaluation for large language models. arXiv preprint
  arXiv:2311.07911, 2023.




                                                                  15
                                                                            SmolLM2

A. Training setup
Table 6 shows the architecture details of SmolLM2 1.7B.


               Table 6. Overview of the architecture of SmolLM2. † This is before extending the context to 8k tokens.
                                                          Parameter                        Value
                                                          Layers                           24
                                                          Model Dimension                2,048
                                                          FFN Dimension                  8,192
                                                          Attention Heads                  32
                                                          Sequence Length               2,048 †
                                                          Token per batch                 2M
                                                          Tied embedding                  Yes
                                                          Positional Embeddings    RoPE (θ = 10, 000)
                                                          Activation Function          SwiGLU


Figure 3 shows the progression of the learning rate through the training using WSD scheduler.

                                                                                                   Learning Rate
                                                5

                                                4




                         Learning Rate (×10 )
                                                3

                                                2

                                                1

                                                0 0   1      2    3     4    5       6     7   8   9    10     11
                                                                              Tokens (T)

Figure 3. Learning rate during SmolLM2 training. We used WSD scheduler with 2000 steps warmup, learning rate 5.0 × 10−4 and 10%
decay.




                                                                              16
                                                                   SmolLM2

B. English web ablations
Figure 4 shows the evaluation curves of ablation models trained on DCLM, FineWeb-Edu and their mix for 350B tokens.

                                  DCLM             FineWeb-Edu                 FineWeb-Edu + DCLM (60/40)

                                       MMLU                                 ARC                      OpenBookQA
                       0.38                                                              0.43
                                                        0.55
                       0.36                                                              0.40

            Accuracy
                                                        0.50
                       0.34                                                              0.38
                                                        0.45                             0.35
                       0.32                             0.40                             0.33
                       0.30                             0.35                             0.30
                              0      100   200   300           0      100    200   300          0      100   200   300
                                    HellaSwag                  CommonsenseQA                              PIQA
                                                        0.40                             0.78
                       0.60
                                                        0.38                             0.75
                       0.55
            Accuracy
                                                        0.36                             0.72
                       0.50                             0.34                             0.70
                       0.45                             0.32                             0.68
                       0.40                             0.30                             0.65
                              0      100   200   300           0      100    200   300          0      100   200   300
                                  Training Tokens (B)              Training Tokens (B)              Training Tokens (B)

Figure 4. Evaluation of models trained on FineWeb-Edu and DCLM for 350B tokens. FineWeb-Edu excels at knowledge and reasoning
tasks, while DCLM demonstrates stronger performance on commonsense reasoning benchmarks. A 60/40 mixture of FineWeb-Edu and
DCLM achieves balanced performance across all tasks.




                                                                       17
                                                                        SmolLM2

C. FineMath
C.1. Public datasets comparison
Figure 5 Shows the performance of ablation models trained on OWM and InfiMM-WebMath on GSM8k and MATH.

                                                  OWM                 InfiMM-WebMath        Baseline
                                                  GSM8K                                       MATH AVG
                               0.14
                                                                                0.02
                               0.12

                               0.10                                             0.01

                    Accuracy   0.08
                                                                                0.01
                               0.06
                                                                                0.01
                               0.04

                                      20     40       60         80       100 0.00     20     40       60         80   100
                                           Training Tokens (B)                              Training Tokens (B)

Figure 5. Results of annealing ablations comparing OWM and the text component of InfiMM-WebMath. InfiMM-WebMath consistently
outperforms OWM on GSM8K, while OWM has a slight advantage on MATH. Despite training on 60B math tokens (equivalent to 5
epochs for OWM and 1.5 epochs for InfiMM-WebMath), performance remains far below state-of-the-art LLMs, highlighting the need for
a new math dataset.


C.2. Annotation Prompt (3-scale)
We used the following prompt template to generate the silver 3-scale annotations for FineMath using the Llama3 model:

     Evaluate the following text extract for its potential usefulness for studying mathematics up to high school and early undergrad-
     uate levels. Use the following 3-point scoring system described below. Points are accumulated based on the satisfaction of
     each criterion:
     - Add 1 point if the extract contains some mathematical content, even if it’s not very useful for studying or is an academic
     paper that is too advanced.
     - Add another point if the extract demonstrates logical reasoning in a mathematical context, even if it lacks step-by-step
     explanations or is too advanced.
     - Award a third point if the extract is at an appropriate level (up to high school and early undergraduate levels) and contains
     clear mathematical deductions and step-by-step solutions to mathematical problems.
     Question-answer formats (e.g., from educational websites or forums) are acceptable if they meet the criteria. Ignore any
     formatting errors or missing equations and make assumptions based on the overall content.
     The text extract:
     <EXTRACT>
     After examining the extract:
     - Briefly justify your total score, up to 100 words.
     - Conclude with the score using the format: "Final score: <total points>".

C.3. Annotation Prompt (5-scale)
We used the following prompt template to generate the 5-scale annotations for FineMath using the Llama3 model during the
second filtering stage:

     Evaluate the following text extract for its potential usefulness for studying mathematics up to high school and early undergrad-
     uate levels. Use the following 5-point scoring system described below. Points are accumulated based on the satisfaction of
     each criterion:

                                                                           18
                                                           SmolLM2

- Add 1 point if the extract contains some mathematical content, even if it’s not very useful for studying, or if it contains
non-academic content such as advertisements and generated pages for converting weight and currencies.
- Add another point if the extract touches on mathematical topics, even if it’s poorly written if it’s too complex such as an
academic paper that is too advanced.
- Award a third point if the extract demonstrates problem solving or logical reasoning in a mathematical context, even if it lacks
 step-by-step explanations.
- Grant a fourth point if the extract is at an appropriate level (up to high school and early undergraduate levels) and contains
clear mathematical deductions and step-by-step solutions to mathematical problems. It should be similar to a chapter from a
textbook or a tutorial.
- Give a fifth point if the extract is outstanding in its educational value for teaching and studying mathematics in middle school
 and high school. It should include very detailed and easy to follow explanations.
Question-answer formats (e.g., from educational websites or forums) are acceptable if they meet the criteria.
The text extract:
<EXTRACT>
After examining the extract:
- Briefly justify your total score, up to 100 words.
- Conclude with the score using the format: Final score: <total points>.




                                                               19
                                                                SmolLM2

D. Stack-Edu
D.1. Annotation Prompt
We used the following prompt template to generate the 5-scale annotations for Stack-Edu (Python in this case) using the
Llama3 model:

     Below is an extract from a Python program. Evaluate whether it has a high educational value and could help teach coding. Use
     the additive 5-point scoring system described below. Points are accumulated based on the satisfaction of each criterion:
     - Add 1 point if the program contains valid Python code, even if it’s not educational, like boilerplate code, configs, and niche
     concepts.
     - Add another point if the program addresses practical concepts, even if it lacks comments.
     - Award a third point if the program is suitable for educational use and introduces key concepts in programming, even if the
     topic is advanced (e.g., deep learning). The code should be well-structured and contain some comments.
     - Give a fourth point if the program is self-contained and highly relevant to teaching programming. It should be similar to a
     school exercise, a tutorial, or a Python course section.
     - Grant a fifth point if the program is outstanding in its educational value and is perfectly suited for teaching programming. It
     should be well-written, easy to understand, and contain step-by-step explanations and comments.
     The extract: <EXAMPLE>
     After examining the extract:
     - Briefly justify your total score, up to 100 words.
     - Conclude with the score using the format: "Educational score: <total points>

We use similar prompts for the other 14 programming languages in Stack-Edu, adjusting the examples in the third criterion
to reflect language-specific topics. For instance, in the JavaScript prompt, we replace "deep learning" with "asynchronous
programming".

D.2. Stack-Edu language statistics
Table 7 shows the size of each programming language in Stack-Edu before and after the educational filtering. Initially, we
also included HTML, but the classifier performed poorly, so we retained StarCoder2Data.


Table 7. Stack-Edu dataset statistics across programming languages. The table shows the original dataset size (from StarCoder2Data) and
filtered Stack-Edu size for each programming language.
                                               Language      StarCoder2Data      Stack-Edu
                                                                  (B tokens)     (B tokens)
                                               Python                    50.6           21.8
                                               Cpp                       69.7           16.0
                                               Markdown                  80.4           14.0
                                               C                         38.4           11.1
                                               JavaScript                45.3           11.1
                                               Java                      45.6           42.1
                                               SQL                       13.7           9.62
                                               PHP                       44.9           9.07
                                               C-Sharp                   33.4           8.87
                                               TypeScript                12.2           3.03
                                               Shell                     4.17           3.13
                                               Swift                     3.71           1.83
                                               Go                        3.67           1.80
                                               Rust                      3.39           1.75
                                               Ruby                      5.76           1.61




                                                                    20
                                                             SmolLM2

E. Detailed pretraining results
E.1. Evaluation after each training stage
Table 8 shows the evaluation results of SmolLM2 at the end of each training stage. In addition to the benchmarks used during
the ablations, we added four generative tasks: CoQA (Reddy et al., 2019), DROP (Dua et al., 2019), Jeopardy (MosaicML,
2024) and SQuAD v2 (Rajpurkar et al., 2018)


Table 8. Per-benchmark model performance across training stages. Stages 1-3 are during stable phase (no learning rate decay).
                                                       Stage 1       Stage 2     Stage 3   Stage 4
                                     Tokens             0-6T          6-8T        8-10T    10-11T
                                     MMLU (MCF)         29.62         37.96        42.54    48.87
                                     HellaSwag          66.17         65.29        66.29    69.26
                                     ARC                59.95         60.08        58.66    60.99
                                     OpenBookQA         42.00         42.40        41.40    43.60
                                     WinoGrande         58.88         58.33        58.64    61.09
                                     PIQA               76.39         76.50        77.26    77.64
                                     GSM8K               4.32         4.62         10.01    32.60
                                     MATH                 2.1         2.78          4.52    11.54
                                     HumanEval          10.97         9.15         17.68    22.60
                                     Multiple-E Java     5.70         10.12        14.56    23.42
                                     Multiple-E JS       9.94         12.42        18.01    23.60
                                     CoQA               33.43         33.98        38.82    40.45
                                     DROP               13.69         11.36        17.19    19.22
                                     Jeopardy            23.1          22.4        25.54    23.35
                                     SQuAD v2           55.97         57.45        57.26    61.48


E.2. MMLU progression
Figure 6 shows the progression of MMLU scores throughout the stable phase.


                           45   MMLU MCF
                                MMLU CF

                           40




            Accuracy (%)
                           35


                           30


                           25

                                3          4       5             6             7           8          9          10
                                                            Tokens (trillions)

Figure 6. Progression of MMLU MCF and MLU CF during the training. We observe above-random (>25%) accuracy on MMLU MCF
after 6T tokens of training, while MMLU CF appears to plateau.




                                                                 21
                                                              SmolLM2

F. Post-training
Table 9 shows the final composition of SmolTalk dataset.


Table 9. Composition of the SmolTalk dataset. The total dataset contains 1.1M instruction-response pairs from different data sources.
                              Dataset source                      Number of samples in SmolTalk
                                                            New datasets
                              MagPie-Ultra                                        431k
                              Smol-Rewrite                                        56.2k
                              Smol-Constraints                                    36.2k
                              Smol-Summarization                                  101k
                                                              Math data
                              NuminaMath-CoT                                       112k
                              MetaMathQA                                            50k
                                                                Other
                              Self-OSS-Starcoder2-Instruct                        50.7k
                              APIGen-Function-Calling                             87.5k
                              SystemChats2.0                                      35.9k
                              LongAlign                                           3.73k
                              Everyday-Conversations                              2.38k
                              Explore-Instruct-Rewriting                           32k
                              OpenHermes2.5                                       100k
                              Total                                               1.1M


Table 10 shows the performance after training on the different components of SmolTalk we consider. The top section
compares the results of fine-tuning SmolLM2 base on different instruction datasets, while the bottom section evaluates
the impact of adding 20% specialized math data to a base mixture of 80% MagPie-Ultra+ during the SFT. The last row,
SmolLM2-SFT, represents the final SFT checkpoint of SmolLM2 before DPO, trained for two epochs on the full SmolTalk
dataset.




                                                                  22
                                                             SmolLM2




Table 10. Performance on instruction-tuning datasets. MagPie-Ultra+ refers to MagPie-Ultra combined with Smol-Constraints, Smol-
Rewrite, and Smol-Summarization. MagPie-Pro-MT is multi-turn while MagPie-Pro is the single turn version. All comparisons were
performed by fine-tuning the SmolLM2 base model on each dataset for 1 epoch. SmolLM2-SFT† , the final supervised fine-tuned version
of SmolLM2, was trained for 2 epochs on SmolTalk.
         Dataset                                   IFEval     MTB      GSM8K        MATH       ARC-C       MMLU-Pro
                                                Instruction datasets comparison
         OpenHermes                                  30.01      1.02       42.91      12.76       40.27            20.32
         UltraChat                                   27.26      4.66       30.40       9.06       41.21            15.79
         MagPie-Pro                                  30.45      4.31       14.56       6.64       36.01            12.19
         MagPie-Pro-MT                               31.66      5.40       20.55       7.84       36.69            11.97
         MagPie-Ultra                                35.49      5.22       24.34      13.56       37.71            12.01
         MagPie-Ultra+                               48.16      5.28       19.94      12.74       38.91            12.43
                                                   Math datasets comparison
         MagPie-Ultra+ + MathInstruct                47.05      5.43        30.1       14.0       38.99            13.65
         MagPie-Ultra+ + MetaMathQA                  44.98      5.02       47.08      17.56       36.77            12.18
         MagPie-Ultra+ + NuminaMath-CoT              46.27      5.99       25.32      18.00       37.88            12.58
                                                         Full SmolTalk
         SmolTalk                                    46.67      5.49       43.75      18.60       40.02            18.19
         SmolLM2-SFT†                                57.09      6.11       47.54      19.64       42.49            19.06




                                                                23
                                                                                                                                SmolLM2

G. Long context evaluations
Figure 7 shows the evaluation results on the Needle in the Haystack benchmark.

                                     100
                                                                                                                         Needle In The Haystack with 10 distractors
                                                                                                                                                                                                                                                Green = 1
                                     90

                                     80

                                     70

                                     60


                     Depth Percent
                                     50

                                     40

                                     30

                                     20

                                     10

                                      0
                                       512   768   1024   1280   1536   1792   2048   2304   2560   2816   3072   3328   3584   3840   4096   4352   4608   4864   5120   5376   5632   5888   6144   6400   6656   6912   7168   7424   7680     7936   8192
                                                                                                                                          Token Limit




                                     Figure 7. Needle in the Haystack evaluation of SmolLM2 with 8192 context length.


Table 11 shows the evaluation results on the HELMET benchmark.

           Table 11. Evaluation results of the base models on the HELMET benchmark using 8k maximum input length.
                                                   Metric                                     SmolLM2-1.7B                                           Llama3.2-1B                                Qwen2.5-1.5B
                                                   Average-Real                                                            31.67                                          35.56                                            38.76
                                                   Average-All                                                             32.61                                          39.61                                            44.40
                                                   Recall                                                                  36.38                                          55.81                                            66.94
                                                   RAG                                                                     47.17                                          42.13                                            47.54
                                                   ICL                                                                     23.20                                          51.20                                            52.00
                                                   Re-rank                                                                 23.31                                          26.93                                            29.29
                                                   LongQA                                                                  33.00                                          21.99                                            26.23




                                                                                                                                         24
