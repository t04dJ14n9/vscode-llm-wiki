---
type: "Paper"
title: "Neural Machine Translation of Rare Words with Subword Units"
description: "Immutable arXiv snapshot of Neural Machine Translation of Rare Words with Subword Units."
resource: "https://arxiv.org/abs/1508.07909v5"
tags: ["paper"]
status: "stable"
generated: {"by": "process:arxiv-ingest", "at": "2026-08-12T20:58:55Z"}
sources: [{"id": "arxiv-record", "resource": "https://arxiv.org/abs/1508.07909v5", "title": "arXiv record for Neural Machine Translation of Rare Words with Subword Units", "last_modified": "2016-06-10"}]
authors: ["Sennrich, Rico", "Haddow, Barry", "Birch, Alexandra"]
source_type: "paper"
source_url: "https://arxiv.org/abs/1508.07909v5"
ingested: "2026-08-13"
submitted: "2015-08-31"
revised: "2016-06-10"
sha256: "38eced47544d28ee156459ef78438a5c67b9cf47314b21e8a9b3126cc8947f8d"
arxiv: {"id": "1508.07909", "version": 5}
license: {"id": "CC-BY-4.0", "url": "https://creativecommons.org/licenses/by/4.0/"}
attachment: {"resource": "../assets/neural-machine-translation-of-rare-words-with-subword-units.pdf", "media_type": "application/pdf", "bytes": 193216, "sha256": "f4e5a6bbbe0d87459997fffe892f8be485e33903cc71f923c2884639fbf96401", "role": "original"}
extraction: {"tool": "pdftotext", "version": "pdftotext version 26.04.0"}
---

# Neural Machine Translation of Rare Words with Subword Units

## Source metadata

- **Authors:** Sennrich, Rico, Haddow, Barry, Birch, Alexandra
- **arXiv:** [1508.07909v5](https://arxiv.org/abs/1508.07909v5)
- **Submitted:** 2015-08-31
- **Revised:** 2016-06-10
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Local attachment:** [Open the archived PDF](../assets/neural-machine-translation-of-rare-words-with-subword-units.pdf)

> Extraction notice: The text below was produced mechanically with
> `pdftotext version 26.04.0`. Reading order, equations, tables, figures, and
> footnotes may be lossy; use the archived PDF as the visual authority.

## Abstract

Neural machine translation (NMT) models typically operate with a fixed vocabulary, but translation is an open-vocabulary problem. Previous work addresses the translation of out-of-vocabulary words by backing off to a dictionary. In this paper, we introduce a simpler and more effective approach, making the NMT model capable of open-vocabulary translation by encoding rare and unknown words as sequences of subword units. This is based on the intuition that various word classes are translatable via smaller units than words, for instance names (via character copying or transliteration), compounds (via compositional translation), and cognates and loanwords (via phonological and morphological transformations). We discuss the suitability of different word segmentation techniques, including simple character n-gram models and a segmentation based on the byte pair encoding compression algorithm, and empirically show that subword models improve over a back-off dictionary baseline for the WMT 15 translation tasks English-German and English-Russian by 1.1 and 1.3 BLEU, respectively.

## Mechanically extracted full text

                                                 Neural Machine Translation of Rare Words with Subword Units

                                                         Rico Sennrich and Barry Haddow and Alexandra Birch
                                                               School of Informatics, University of Edinburgh
                                                   {rico.sennrich,a.birch}@ed.ac.uk, bhaddow@inf.ed.ac.uk




arXiv:1508.07909v5 [cs.CL] 10 Jun 2016
                                                                 Abstract                                lem, and especially for languages with produc-
                                                                                                         tive word formation processes such as aggluti-
                                             Neural machine translation (NMT) mod-                       nation and compounding, translation models re-
                                             els typically operate with a fixed vocabu-                  quire mechanisms that go below the word level.
                                             lary, but translation is an open-vocabulary                 As an example, consider compounds such as the
                                             problem. Previous work addresses the                        German Abwasser|behandlungs|anlange ‘sewage
                                             translation of out-of-vocabulary words by                   water treatment plant’, for which a segmented,
                                             backing off to a dictionary. In this pa-                    variable-length representation is intuitively more
                                             per, we introduce a simpler and more ef-                    appealing than encoding the word as a fixed-length
                                             fective approach, making the NMT model                      vector.
                                             capable of open-vocabulary translation by                      For word-level NMT models, the translation
                                             encoding rare and unknown words as se-                      of out-of-vocabulary words has been addressed
                                             quences of subword units. This is based on                  through a back-off to a dictionary look-up (Jean et
                                             the intuition that various word classes are                 al., 2015; Luong et al., 2015b). We note that such
                                             translatable via smaller units than words,                  techniques make assumptions that often do not
                                             for instance names (via character copying                   hold true in practice. For instance, there is not al-
                                             or transliteration), compounds (via com-                    ways a 1-to-1 correspondence between source and
                                             positional translation), and cognates and                   target words because of variance in the degree of
                                             loanwords (via phonological and morpho-                     morphological synthesis between languages, like
                                             logical transformations). We discuss the                    in our introductory compounding example. Also,
                                             suitability of different word segmentation                  word-level models are unable to translate or gen-
                                             techniques, including simple character n-                   erate unseen words. Copying unknown words into
                                             gram models and a segmentation based on                     the target text, as done by (Jean et al., 2015; Luong
                                             the byte pair encoding compression algo-                    et al., 2015b), is a reasonable strategy for names,
                                             rithm, and empirically show that subword                    but morphological changes and transliteration is
                                             models improve over a back-off dictionary                   often required, especially if alphabets differ.
                                             baseline for the WMT 15 translation tasks                      We investigate NMT models that operate on the
                                             English→German and English→Russian                          level of subword units. Our main goal is to model
                                             by up to 1.1 and 1.3 B LEU, respectively.                   open-vocabulary translation in the NMT network
                                                                                                         itself, without requiring a back-off model for rare
                                         1 Introduction                                                  words. In addition to making the translation pro-
                                                                                                         cess simpler, we also find that the subword models
                                         Neural machine translation has recently shown
                                                                                                         achieve better accuracy for the translation of rare
                                         impressive results (Kalchbrenner and Blunsom,
                                                                                                         words than large-vocabulary models and back-off
                                         2013; Sutskever et al., 2014; Bahdanau et al.,
                                                                                                         dictionaries, and are able to productively generate
                                         2015). However, the translation of rare words
                                                                                                         new words that were not seen at training time. Our
                                         is an open problem. The vocabulary of neu-
                                                                                                         analysis shows that the neural networks are able to
                                         ral models is typically limited to 30 000–50 000
                                                                                                         learn compounding and transliteration from sub-
                                         words, but translation is an open-vocabulary prob-
                                                                                                         word representations.
                                              The research presented in this publication was conducted      This paper has two main contributions:
                                         in cooperation with Samsung Electronics Polska sp. z o.o. -
                                         Samsung R&D Institute Poland.                                      • We show that open-vocabulary neural ma-
     chine translation is possible by encoding          that they are translatable by a competent transla-
     (rare) words via subword units. We find our        tor even if they are novel to him or her, based
     architecture simpler and more effective than       on a translation of known subword units such as
     using large vocabularies and back-off dictio-      morphemes or phonemes. Word categories whose
     naries (Jean et al., 2015; Luong et al., 2015b).   translation is potentially transparent include:
   • We adapt byte pair encoding (BPE) (Gage,              • named entities. Between languages that share
     1994), a compression algorithm, to the task             an alphabet, names can often be copied from
     of word segmentation. BPE allows for the                source to target text. Transcription or translit-
     representation of an open vocabulary through            eration may be required, especially if the al-
     a fixed-size vocabulary of variable-length              phabets or syllabaries differ. Example:
     character sequences, making it a very suit-             Barack Obama (English; German)
     able word segmentation strategy for neural              Барак Обама (Russian)
     network models.                                         バラク・オバマ (ba-ra-ku o-ba-ma) (Japanese)
                                                           • cognates and loanwords. Cognates and loan-
2 Neural Machine Translation
                                                             words with a common origin can differ in
We follow the neural machine translation archi-              regular ways between languages, so that
tecture by Bahdanau et al. (2015), which we will             character-level translation rules are sufficient
briefly summarize here. However, we note that our            (Tiedemann, 2012). Example:
approach is not specific to this architecture.               claustrophobia (English)
   The neural machine translation system is imple-           Klaustrophobie (German)
mented as an encoder-decoder network with recur-             Клаустрофобия (Klaustrofobiâ) (Russian)
rent neural networks.                                      • morphologically complex words. Words con-
   The encoder is a bidirectional neural network             taining multiple morphemes, for instance
with gated recurrent units (Cho et al., 2014)                formed via compounding, affixation, or in-
that reads an input sequence x = (x1 , ..., xm )             flection, may be translatable by translating
and calculates a forward sequence of hidden                  the morphemes separately. Example:
           −
           →        −
                    →
states ( h 1 , ..., h m ), and a backward sequence           solar system (English)
 ←−         ←−                        −
                                      →       ←−
( h 1 , ..., h m ). The hidden states h j and h j are        Sonnensystem (Sonne + System) (German)
concatenated to obtain the annotation vector hj .            Naprendszer (Nap + Rendszer) (Hungarian)
   The decoder is a recurrent neural network that
                                                            In an analysis of 100 rare tokens (not among
predicts a target sequence y = (y1 , ..., yn ). Each
                                                        the 50 000 most frequent types) in our German
word yi is predicted based on a recurrent hidden
                                                        training data1 , the majority of tokens are poten-
state si , the previously predicted word yi−1 , and
                                                        tially translatable from English through smaller
a context vector ci . ci is computed as a weighted
                                                        units.     We find 56 compounds, 21 names,
sum of the annotations hj . The weight of each
                                                        6 loanwords with a common origin (emanci-
annotation hj is computed through an alignment
                                                        pate→emanzipieren), 5 cases of transparent affix-
model αij , which models the probability that yi is
                                                        ation (sweetish ‘sweet’ + ‘-ish’ → süßlich ‘süß’ +
aligned to xj . The alignment model is a single-
                                                        ‘-lich’), 1 number and 1 computer language iden-
layer feedforward neural network that is learned
                                                        tifier.
jointly with the rest of the network through back-
                                                            Our hypothesis is that a segmentation of rare
propagation.
                                                        words into appropriate subword units is suffi-
   A detailed description can be found in (Bah-
                                                        cient to allow for the neural translation network
danau et al., 2015). Training is performed on a
                                                        to learn transparent translations, and to general-
parallel corpus with stochastic gradient descent.
                                                        ize this knowledge to translate and produce unseen
For translation, a beam search with small beam
                                                        words.2 We provide empirical support for this hy-
size is employed.
                                                           1
                                                             Primarily parliamentary proceedings and web crawl data.
                                                           2
3 Subword Translation                                        Not every segmentation we produce is transparent.
                                                        While we expect no performance benefit from opaque seg-
                                                        mentations, i.e. segmentations where the units cannot be
The main motivation behind this paper is that           translated independently, our NMT models show robustness
the translation of some words is transparent in         towards oversplitting.
pothesis in Sections 4 and 5. First, we discuss dif-    tion on different subword units at each step. Re-
ferent subword representations.                         call our introductory example Abwasserbehand-
                                                        lungsanlange, for which a subword segmentation
3.1   Related Work                                      avoids the information bottleneck of a fixed-length
                                                        representation.
For Statistical Machine Translation (SMT), the
translation of unknown words has been the subject          Neural machine translation differs from phrase-
of intensive research.                                  based methods in that there are strong incentives to
                                                        minimize the vocabulary size of neural models to
   A large proportion of unknown words are
                                                        increase time and space efficiency, and to allow for
names, which can just be copied into the tar-
                                                        translation without back-off models. At the same
get text if both languages share an alphabet. If
                                                        time, we also want a compact representation of the
alphabets differ, transliteration is required (Dur-
                                                        text itself, since an increase in text length reduces
rani et al., 2014). Character-based translation has
                                                        efficiency and increases the distances over which
also been investigated with phrase-based models,
                                                        neural models need to pass information.
which proved especially successful for closely re-
lated languages (Vilar et al., 2007; Tiedemann,            A simple method to manipulate the trade-off be-
2009; Neubig et al., 2012).                             tween vocabulary size and text size is to use short-
                                                        lists of unsegmented words, using subword units
   The segmentation of morphologically complex
                                                        only for rare words. As an alternative, we pro-
words such as compounds is widely used for SMT,
                                                        pose a segmentation algorithm based on byte pair
and various algorithms for morpheme segmen-
                                                        encoding (BPE), which lets us learn a vocabulary
tation have been investigated (Nießen and Ney,
                                                        that provides a good compression rate of the text.
2000; Koehn and Knight, 2003; Virpioja et al.,
2007; Stallard et al., 2012). Segmentation al-
                                                        3.2 Byte Pair Encoding (BPE)
gorithms commonly used for phrase-based SMT
tend to be conservative in their splitting decisions,   Byte Pair Encoding (BPE) (Gage, 1994) is a sim-
whereas we aim for an aggressive segmentation           ple data compression technique that iteratively re-
that allows for open-vocabulary translation with a      places the most frequent pair of bytes in a se-
compact network vocabulary, and without having          quence with a single, unused byte. We adapt this
to resort to back-off dictionaries.                     algorithm for word segmentation. Instead of merg-
   The best choice of subword units may be task-        ing frequent pairs of bytes, we merge characters or
specific. For speech recognition, phone-level lan-      character sequences.
guage models have been used (Bazzi and Glass,              Firstly, we initialize the symbol vocabulary with
2000). Mikolov et al. (2012) investigate subword        the character vocabulary, and represent each word
language models, and propose to use syllables.          as a sequence of characters, plus a special end-of-
For multilingual segmentation tasks, multilingual       word symbol ‘·’, which allows us to restore the
algorithms have been proposed (Snyder and Barzi-        original tokenization after translation. We itera-
lay, 2008). We find these intriguing, but inapplica-    tively count all symbol pairs and replace each oc-
ble at test time.                                       currence of the most frequent pair (‘A’, ‘B’) with
   Various techniques have been proposed to pro-        a new symbol ‘AB’. Each merge operation pro-
duce fixed-length continuous word vectors based         duces a new symbol which represents a charac-
on characters or morphemes (Luong et al., 2013;         ter n-gram. Frequent character n-grams (or whole
Botha and Blunsom, 2014; Ling et al., 2015a; Kim        words) are eventually merged into a single sym-
et al., 2015). An effort to apply such techniques       bol, thus BPE requires no shortlist. The final sym-
to NMT, parallel to ours, has found no significant      bol vocabulary size is equal to the size of the initial
improvement over word-based approaches (Ling            vocabulary, plus the number of merge operations
et al., 2015b). One technical difference from our       – the latter is the only hyperparameter of the algo-
work is that the attention mechanism still oper-        rithm.
ates on the level of words in the model by Ling            For efficiency, we do not consider pairs that
et al. (2015b), and that the representation of each     cross word boundaries. The algorithm can thus be
word is fixed-length. We expect that the attention      run on the dictionary extracted from a text, with
mechanism benefits from our variable-length rep-        each word being weighted by its frequency. A
resentation: the network can learn to place atten-      minimal Python implementation is shown in Al-
Algorithm 1 Learn BPE operations                                     We evaluate two methods of applying BPE:
import re, collections
                                                                  learning two independent encodings, one for the
                                                                  source, one for the target vocabulary, or learning
def get_stats(vocab):
  pairs = collections.defaultdict(int)                            the encoding on the union of the two vocabular-
  for word, freq in vocab.items():
    symbols = word.split()                                        ies (which we call joint BPE).4 The former has the
    for i in range(len(symbols)-1):                               advantage of being more compact in terms of text
      pairs[symbols[i],symbols[i+1]] += freq
  return pairs                                                    and vocabulary size, and having stronger guaran-
def merge_vocab(pair, v_in):                                      tees that each subword unit has been seen in the
  v_out = {}                                                      training text of the respective language, whereas
  bigram = re.escape(' '.join(pair))
  p = re.compile(r'(?<!\S)' + bigram + r'(?!\S)')                 the latter improves consistency between the source
  for word in v_in:
    w_out = p.sub(''.join(pair), word)                            and the target segmentation. If we apply BPE in-
    v_out[w_out] = v_in[word]
  return v_out
                                                                  dependently, the same name may be segmented
                                                                  differently in the two languages, which makes it
vocab = {'l o w </w>' : 5, 'l o w e r </w>' : 2,
         'n e w e s t </w>':6, 'w i d e s t </w>':3}              harder for the neural models to learn a mapping
num_merges = 10
for i in range(num_merges):                                       between the subword units. To increase the con-
  pairs = get_stats(vocab)                                        sistency between English and Russian segmenta-
  best = max(pairs, key=pairs.get)
  vocab = merge_vocab(best, vocab)                                tion despite the differing alphabets, we transliter-
  print(best)
                                                                  ate the Russian vocabulary into Latin characters
                                                                  with ISO-9 to learn the joint BPE encoding, then
                      r·      →     r·                            transliterate the BPE merge operations back into
                      lo      →     lo
                      lo w    →     low                           Cyrillic to apply them to the Russian training text.5
                      e r·    →     er·
                                                                  4 Evaluation
Figure 1: BPE merge operations learned from dic-
tionary {‘low’, ‘lowest’, ‘newer’, ‘wider’}.                      We aim to answer the following empirical ques-
                                                                  tions:

gorithm 1. In practice, we increase efficiency by                    • Can we improve the translation of rare and
indexing all pairs, and updating data structures in-                   unseen words in neural machine translation
crementally.                                                           by representing them via subword units?
   The main difference to other compression al-
                                                                     • Which segmentation into subword units per-
gorithms, such as Huffman encoding, which have
                                                                       forms best in terms of vocabulary size, text
been proposed to produce a variable-length en-
                                                                       size, and translation quality?
coding of words for NMT (Chitnis and DeNero,
2015), is that our symbol sequences are still in-                    We perform experiments on data from the
terpretable as subword units, and that the network                shared translation task of WMT 2015. For
can generalize to translate and produce new words                 English→German, our training set consists of 4.2
(unseen at training time) on the basis of these sub-              million sentence pairs, or approximately 100 mil-
word units.                                                       lion tokens. For English→Russian, the training set
   Figure 1 shows a toy example of learned BPE                    consists of 2.6 million sentence pairs, or approx-
operations. At test time, we first split words into               imately 50 million tokens. We tokenize and true-
sequences of characters, then apply the learned op-               case the data with the scripts provided in Moses
erations to merge the characters into larger, known               (Koehn et al., 2007). We use newstest2013 as de-
symbols. This is applicable to any word, and                      velopment set, and report results on newstest2014
allows for open-vocabulary networks with fixed                    and newstest2015.
symbol vocabularies.3 In our example, the OOV                        We report results with B LEU (mteval-v13a.pl),
‘lower’ would be segmented into ‘low er·’.                        and CHR F3 (Popović, 2015), a character n-gram
   3
     The only symbols that will be unknown at test time are       F3 score which was found to correlate well with
unknown characters, or symbols of which all occurrences
                                                                     4
in the training text have been merged into larger symbols,              In practice, we simply concatenate the source and target
like ‘safeguar’, which has all occurrences in our training text   side of the training set to learn joint BPE.
                                                                      5
merged into ‘safeguard’. We observed no such symbols at                 Since the Russian training text also contains words that
test time, but the issue could be easily solved by recursively    use the Latin alphabet, we also apply the Latin BPE opera-
reversing specific merges until all symbols are known.            tions.
human judgments, especially for translations out                  man side of the parallel data are shown in Table
of English (Stanojević et al., 2015). Since our                  1. A simple baseline is the segmentation of words
main claim is concerned with the translation of                   into character n-grams.9 Character n-grams allow
rare and unseen words, we report separate statis-                 for different trade-offs between sequence length
tics for these. We measure these through unigram                  (# tokens) and vocabulary size (# types), depend-
F1 , which we calculate as the harmonic mean of                   ing on the choice of n. The increase in sequence
clipped unigram precision and recall.6                            length is substantial; one way to reduce sequence
   We perform all experiments with Groundhog7                     length is to leave a shortlist of the k most frequent
(Bahdanau et al., 2015). We generally follow set-                 word types unsegmented. Only the unigram repre-
tings by previous work (Bahdanau et al., 2015;                    sentation is truly open-vocabulary. However, the
Jean et al., 2015). All networks have a hidden                    unigram representation performed poorly in pre-
layer size of 1000, and an embedding layer size                   liminary experiments, and we report translation re-
of 620. Following Jean et al. (2015), we only keep                sults with a bigram representation, which is empir-
a shortlist of τ = 30000 words in memory.                         ically better, but unable to produce some tokens in
   During training, we use Adadelta (Zeiler, 2012),               the test set with the training set vocabulary.
a minibatch size of 80, and reshuffle the train-                     We report statistics for several word segmenta-
ing set between epochs. We train a network for                    tion techniques that have proven useful in previous
approximately 7 days, then take the last 4 saved                  SMT research, including frequency-based com-
models (models being saved every 12 hours), and                   pound splitting (Koehn and Knight, 2003), rule-
continue training each with a fixed embedding                     based hyphenation (Liang, 1983), and Morfessor
layer (as suggested by (Jean et al., 2015)) for 12                (Creutz and Lagus, 2002). We find that they only
hours. We perform two independent training runs                   moderately reduce vocabulary size, and do not
for each models, once with cut-off for gradient                   solve the unknown word problem, and we thus find
clipping (Pascanu et al., 2013) of 5.0, once with                 them unsuitable for our goal of open-vocabulary
a cut-off of 1.0 – the latter produced better single              translation without back-off dictionary.
models for most settings. We report results of the
system that performed best on our development set                    BPE meets our goal of being open-vocabulary,
(newstest2013), and of an ensemble of all 8 mod-                  and the learned merge operations can be applied
els.                                                              to the test set to obtain a segmentation with no
                                                                  unknown symbols.10 Its main difference from
   We use a beam size of 12 for beam search,
                                                                  the character-level model is that the more com-
with probabilities normalized by sentence length.
                                                                  pact representation of BPE allows for shorter se-
We use a bilingual dictionary based on fast-align
                                                                  quences, and that the attention model operates
(Dyer et al., 2013). For our baseline, this serves
                                                                  on variable-length units.11 Table 1 shows BPE
as back-off dictionary for rare words. We also use
                                                                  with 59 500 merge operations, and joint BPE with
the dictionary to speed up translation for all ex-
                                                                  89 500 operations.
periments, only performing the softmax over a fil-
tered list of candidate translations (like Jean et al.               In practice, we did not include infrequent sub-
(2015), we use K = 30000; K ′ = 10).                              word units in the NMT network vocabulary, since
                                                                  there is noise in the subword symbol sets, e.g.
4.1    Subword statistics                                         because of characters from foreign alphabets.
Apart from translation quality, which we will ver-                Hence, our network vocabularies in Table 2 are
ify empirically, our main objective is to represent               typically slightly smaller than the number of types
an open vocabulary through a compact fixed-size                   in Table 1.
subword vocabulary, and allow for efficient train-
ing and decoding.8                                                    9
                                                                        Our character n-grams do not cross word boundaries. We
   Statistics for different segmentations of the Ger-             mark whether a subword is word-final or not with a special
                                                                  character, which allows us to restore the original tokenization.
   6                                                                 10
      Clipped unigram precision is essentially 1-gram BLEU              Joint BPE can produce segments that are unknown be-
without brevity penalty.                                          cause they only occur in the English training text, but these
    7
      github.com/sebastien-j/LV_groundhog                         are rare (0.05% of test tokens).
    8                                                                11
      The time complexity of encoder-decoder architectures is           We highlighted the limitations of word-level attention in
at least linear to sequence length, and oversplitting harms ef-   section 3.1. At the other end of the spectrum, the character
ficiency.                                                         level is suboptimal for alignment (Tiedemann, 2009).
                                                vocabulary         B LEU       CHR F3       unigram F1 (%)
           name       segmentation shortlist source     target single ens-8 single ens-8     all rare OOV
           syntax-based (Sennrich and Haddow, 2015)              24.4     - 55.3       -   59.1 46.0 37.7
           WUnk       -                    - 300 000 500 000 20.6 22.8 47.2 48.9           56.7 20.4    0.0
           WDict      -                    - 300 000 500 000 22.0 24.2 50.5 52.4           58.1 36.8 36.8
           C2-50k     char-bigram     50 000 60 000 60 000 22.8 25.3 51.9 53.5             58.4 40.5 30.9
           BPE-60k BPE                     - 60 000 60 000 21.5 24.5 52.0 53.9             58.4 40.9 29.3
           BPE-J90k BPE (joint)            - 90 000 90 000 22.8 24.7 51.7 54.1             58.5 41.8 33.6

Table 2: English→German translation performance (B LEU, CHR F3 and unigram F1 ) on newstest2015.
Ens-8: ensemble of 8 models. Best NMT system in bold. Unigram F1 (with ensembles) is computed for
all words (n = 44085), rare words (not among top 50 000 in training set; n = 2900), and OOVs (not in
training set; n = 1168).

  segmentation            # tokens       # types   # UNK           Unigram F1 scores indicate that learning the
  none                      100 m     1 750 000      1079
  characters                550 m          3000         0       BPE symbols on the vocabulary union (BPE-
  character bigrams         306 m        20 000        34       J90k) is more effective than learning them sep-
  character trigrams        214 m       120 000        59       arately (BPE-60k), and more effective than using
  compound splitting△       102 m     1 100 000       643
  morfessor*                109 m       544 000       237       character bigrams with a shortlist of 50 000 unseg-
  hyphenation⋄              186 m       404 000       230       mented words (C2-50k), but all reported subword
  BPE                       112 m        63 000         0       segmentations are viable choices and outperform
  BPE (joint)               111 m        82 000        32
  character bigrams                                             the back-off dictionary baseline.
                            129 m        69 000         34
  (shortlist: 50 000)
                                                                   Our subword representations cause big im-
Table 1: Corpus statistics for German training                  provements in the translation of rare and unseen
corpus with different word segmentation tech-                   words, but these only constitute 9-11% of the test
niques. #UNK: number of unknown tokens in                       sets. Since rare words tend to carry central in-
newstest2013. △: (Koehn and Knight, 2003); *:                   formation in a sentence, we suspect that B LEU
(Creutz and Lagus, 2002); ⋄: (Liang, 1983).                     and CHR F3 underestimate their effect on transla-
                                                                tion quality. Still, we also see improvements over
                                                                the baseline in total unigram F1 , as well as B LEU
4.2    Translation experiments                                  and CHR F3, and the subword ensembles outper-
English→German translation results are shown in                 form the WDict baseline by 0.3–1.3 B LEU and
Table 2; English→Russian results in Table 3.                    0.6–2 CHR F3. There is some inconsistency be-
   Our baseline WDict is a word-level model with                tween B LEU and CHR F3, which we attribute to the
a back-off dictionary. It differs from WUnk in that             fact that B LEU has a precision bias, and CHR F3 a
the latter uses no back-off dictionary, and just rep-           recall bias.
resents out-of-vocabulary words as UNK12 . The                     For English→German, we observe the best
back-off dictionary improves unigram F1 for rare                B LEU score of 25.3 with C2-50k, but the best
and unseen words, although the improvement is                   CHR F3 score of 54.1 with BPE-J90k. For com-
smaller for English→Russian, since the back-off                 parison to the (to our knowledge) best non-neural
dictionary is incapable of transliterating names.               MT system on this data set, we report syntax-
   All subword systems operate without a back-off               based SMT results (Sennrich and Haddow, 2015).
dictionary. We first focus on unigram F1 , where                We observe that our best systems outperform the
all systems improve over the baseline, especially               syntax-based system in terms of B LEU, but not
for rare words (36.8%→41.8% for EN→DE;                          in terms of CHR F3. Regarding other neural sys-
26.5%→29.7% for EN→RU). For OOVs, the                           tems, Luong et al. (2015a) report a B LEU score of
baseline strategy of copying unknown words                      25.9 on newstest2015, but we note that they use an
works well for English→German. However, when                    ensemble of 8 independently trained models, and
alphabets differ, like in English→Russian, the                  also report strong improvements from applying
subword models do much better.                                  dropout, which we did not use. We are confident
  12
                                                                that our improvements to the translation of rare
      We use UNK for words that are outside the model vo-
cabulary, and OOV for those that do not occur in the training   words are orthogonal to improvements achievable
text.                                                           through other improvements in the network archi-
tecture, training algorithm, or better ensembles.              systems can productively form new words such as
   For English→Russian, the state of the art is                compounds.
the phrase-based system by Haddow et al. (2015).
It outperforms our WDict baseline by 1.5 B LEU.                   For the 50 000 most frequent words, the repre-
The subword models are a step towards closing                  sentation is the same for all neural networks, and
this gap, and BPE-J90k yields an improvement of                all neural networks achieve comparable unigram
1.3 B LEU, and 2.0 CHR F3, over WDict.                         F1 for this category. For the interval between fre-
   As a further comment on our translation results,            quency rank 50 000 and 500 000, the comparison
we want to emphasize that performance variabil-                between C2-3/500k and C2-50k unveils an inter-
ity is still an open problem with NMT. On our de-              esting difference. The two systems only differ in
velopment set, we observe differences of up to 1               the size of the shortlist, with C2-3/500k represent-
B LEU between different models. For single sys-                ing words in this interval as single units, and C2-
tems, we report the results of the model that per-             50k via subword units. We find that the perfor-
forms best on dev (out of 8), which has a stabi-               mance of C2-3/500k degrades heavily up to fre-
lizing effect, but how to control for randomness               quency rank 500 000, at which point the model
deserves further attention in future research.                 switches to a subword representation and perfor-
                                                               mance recovers. The performance of C2-50k re-
5 Analysis                                                     mains more stable. We attribute this to the fact
                                                               that subword units are less sparse than words. In
5.1   Unigram accuracy                                         our training set, the frequency rank 50 000 corre-
Our main claims are that the translation of rare and           sponds to a frequency of 60 in the training data;
unknown words is poor in word-level NMT mod-                   the frequency rank 500 000 to a frequency of 2.
els, and that subword models improve the trans-                Because subword representations are less sparse,
lation of these word types. To further illustrate              reducing the size of the network vocabulary, and
the effect of different subword segmentations on               representing more words via subword units, can
the translation of rare and unseen words, we plot              lead to better performance.
target-side words sorted by their frequency in the
training set.13 To analyze the effect of vocabulary               The F1 numbers hide some qualitative differ-
size, we also include the system C2-3/500k, which              ences between systems. For English→German,
is a system with the same vocabulary size as the               WDict produces few OOVs (26.5% recall), but
WDict baseline, and character bigrams to repre-                with high precision (60.6%) , whereas the subword
sent unseen words.                                             systems achieve higher recall, but lower precision.
                                                               We note that the character bigram model C2-50k
   Figure 2 shows results for the English–German
                                                               produces the most OOV words, and achieves rel-
ensemble systems on newstest2015. Unigram
                                                               atively low precision of 29.1% for this category.
F1 of all systems tends to decrease for lower-
                                                               However, it outperforms the back-off dictionary
frequency words. The baseline system has a spike
                                                               in recall (33.0%). BPE-60k, which suffers from
in F1 for OOVs, i.e. words that do not occur in
                                                               transliteration (or copy) errors due to segmenta-
the training text. This is because a high propor-
                                                               tion inconsistencies, obtains a slightly better pre-
tion of OOVs are names, for which a copy from
                                                               cision (32.4%), but a worse recall (26.6%). In con-
the source to the target text is a good strategy for
                                                               trast to BPE-60k, the joint BPE encoding of BPE-
English→German.
                                                               J90k improves both precision (38.6%) and recall
   The systems with a target vocabulary of 500 000
                                                               (29.8%).
words mostly differ in how well they translate
words with rank > 500 000. A back-off dictionary
                                                                  For English→Russian, unknown names can
is an obvious improvement over producing UNK,
                                                               only rarely be copied, and usually require translit-
but the subword system C2-3/500k achieves better
                                                               eration. Consequently, the WDict baseline per-
performance. Note that all OOVs that the back-
                                                               forms more poorly for OOVs (9.2% precision;
off dictionary produces are words that are copied
                                                               5.2% recall), and the subword models improve
from the source, usually names, while the subword
                                                               both precision and recall (21.9% precision and
   13
      We perform binning of words with the same training set   15.6% recall for BPE-J90k). The full unigram F1
frequency, and apply bezier smoothing to the graph.            plot is shown in Figure 3.
                                                         vocabulary         B LEU       CHR F3       unigram F1 (%)
                   name       segmentation shortlist source      target single ens-8 single ens-8     all rare OOV
                   phrase-based (Haddow et al., 2015)                     24.3     - 53.8       -   56.0 31.3 16.5
                   WUnk       -                     - 300 000 500 000 18.8 22.4 46.5 49.9           54.2 25.2    0.0
                   WDict      -                     - 300 000 500 000 19.1 22.8 47.5 51.0           54.8 26.5    6.6
                   C2-50k     char-bigram      50 000 60 000 60 000 20.9 24.1 49.0 51.6             55.2 27.8 17.4
                   BPE-60k BPE                      - 60 000 60 000 20.5 23.6 49.8 52.7             55.3 29.7 15.6
                   BPE-J90k BPE (joint)             - 90 000 100 000 20.4 24.1 49.7 53.0            55.8 29.7 18.3

Table 3: English→Russian translation performance (B LEU, CHR F3 and unigram F1 ) on newstest2015.
Ens-8: ensemble of 8 models. Best NMT system in bold. Unigram F1 (with ensembles) is computed for
all words (n = 55654), rare words (not among top 50 000 in training set; n = 5442), and OOVs (not in
training set; n = 851).


                                                                     5.2 Manual Analysis
              1
                                                 50 000   500 000    Table 4 shows two translation examples for
                                                                     the translation direction English→German, Ta-
             0.8
                                                                     ble 5 for English→Russian. The baseline sys-
                                                                     tem fails for all of the examples, either by delet-

unigram F1
             0.6
                                                                     ing content (health), or by copying source words
                                                                     that should be translated or transliterated. The
             0.4                                                     subword translations of health research insti-
                        BPE-J90k
                        C2-50k                                       tutes show that the subword systems are capa-
             0.2        C2-300/500k
                                                                     ble of learning translations when oversplitting (re-
                        WDict
                        WUnk                                         search→Fo|rs|ch|un|g), or when the segmentation
              0                                                      does not match morpheme boundaries: the seg-
              100     101       102 103 104 105              106     mentation Forschungs|instituten would be linguis-
                            training set frequency rank
                                                                     tically more plausible, and simpler to align to the
                                                                     English research institutes, than the segmentation
Figure 2: English→German unigram F1 on new-                          Forsch|ungsinstitu|ten in the BPE-60k system, but
stest2015 plotted by training set frequency rank                     still, a correct translation is produced. If the sys-
for different NMT systems.                                           tems have failed to learn a translation due to data
                                                                     sparseness, like for asinine, which should be trans-
                                                                     lated as dumm, we see translations that are wrong,
                                                                     but could be plausible for (partial) loanwords (asi-
              1
                                                 50 000   500 000    nine Situation→Asinin-Situation).
             0.8
                                                                        The English→Russian examples show that
                                                                     the subword systems are capable of translitera-
                                                                     tion. However, transliteration errors do occur,

unigram F1
             0.6
                                                                     either due to ambiguous transliterations, or be-
                                                                     cause of non-consistent segmentations between
             0.4                                                     source and target text which make it hard for
                        BPE-J90k                                     the system to learn a transliteration mapping.
             0.2        C2-50k
                                                                     Note that the BPE-60k system encodes Mirza-
                        WDict
                        WUnk                                         yeva inconsistently for the two language pairs
              0                                                      (Mirz|ayeva→Мир|за|ева Mir|za|eva). This ex-
              100     101       102 103 104 105               106
                                                                     ample is still translated correctly, but we observe
                            training set frequency rank
                                                                     spurious insertions and deletions of characters in
                                                                     the BPE-60k system. An example is the translit-
Figure 3: English→Russian unigram F1 on new-                         eration of rakfisk, where a п is inserted and a к
stest2015 plotted by training set frequency rank                     is deleted. We trace this error back to transla-
for different NMT systems.                                           tion pairs in the training data with inconsistent
                                                                     segmentations, such as (p|rak|ri|ti→пра|крит|и
  system       sentence                                        system, and that reducing the vocabulary size
  source       health research institutes
  reference    Gesundheitsforschungsinstitute                  of subword models can actually improve perfor-
  WDict        Forschungsinstitute                             mance. In this work, our choice of vocabulary size
  C2-50k       Fo|rs|ch|un|gs|in|st|it|ut|io|ne|n              is somewhat arbitrary, and mainly motivated by
  BPE-60k      Gesundheits|forsch|ungsinstitu|ten
  BPE-J90k     Gesundheits|forsch|ungsin|stitute               comparison to prior work. One avenue of future
  source       asinine situation                               research is to learn the optimal vocabulary size for
  reference    dumme Situation
  WDict        asinine situation → UNK → asinine
                                                               a translation task, which we expect to depend on
  C2-50k       as|in|in|e situation → As|in|en|si|tu|at|io|n   the language pair and amount of training data, au-
  BPE-60k      as|in|ine situation → A|in|line-|Situation      tomatically. We also believe there is further po-
  BPE-J90K     as|in|ine situation → As|in|in-|Situation
                                                               tential in bilingually informed segmentation algo-
Table 4: English→German translation example.                   rithms to create more alignable subword units, al-
“|” marks subword boundaries.                                  though the segmentation algorithm cannot rely on
                                                               the target text at runtime.
 system       sentence
 source       Mirzayeva
                                                                  While the relative effectiveness will depend on
 reference    Мирзаева (Mirzaeva)                              language-specific factors such as vocabulary size,
 WDict        Mirzayeva → UNK → Mirzayeva                      we believe that subword segmentations are suit-
 C2-50k       Mi|rz|ay|ev|a → Ми|рз|ае|ва (Mi|rz|ae|va)
 BPE-60k      Mirz|ayeva → Мир|за|ева (Mir|za|eva)             able for most language pairs, eliminating the need
 BPE-J90k     Mir|za|yeva → Мир|за|ева (Mir|za|eva)            for large NMT vocabularies or back-off models.
 source       rakfisk
 reference    ракфиска (rakfiska)
 WDict        rakfisk → UNK → rakfisk                          Acknowledgments
 C2-50k       ra|kf|is|k → ра|кф|ис|к (ra|kf|is|k)
 BPE-60k      rak|f|isk → пра|ф|иск (pra|f|isk)                We thank Maja Popović for her implementa-
 BPE-J90k     rak|f|isk → рак|ф|иска (rak|f|iska)              tion of CHR F, with which we verified our re-
                                                               implementation. The research presented in this
Table 5: English→Russian translation examples.
                                                               publication was conducted in cooperation with
“|” marks subword boundaries.
                                                               Samsung Electronics Polska sp. z o.o. - Sam-
                                                               sung R&D Institute Poland. This project received
(pra|krit|i)), from which the translation (rak→пра)            funding from the European Union’s Horizon 2020
is erroneously learned. The segmentation of the                research and innovation programme under grant
joint BPE system (BPE-J90k) is more consistent                 agreement 645452 (QT21).
(pra|krit|i→пра|крит|и (pra|krit|i)).

6 Conclusion                                                   References
The main contribution of this paper is that we                 Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Ben-
show that neural machine translation systems are                 gio. 2015. Neural Machine Translation by Jointly
capable of open-vocabulary translation by repre-                 Learning to Align and Translate. In Proceedings of
                                                                 the International Conference on Learning Represen-
senting rare and unseen words as a sequence of                   tations (ICLR).
subword units.14 This is both simpler and more
effective than using a back-off translation model.             Issam Bazzi and James R. Glass. 2000. Modeling out-
We introduce a variant of byte pair encoding for                  of-vocabulary words for robust speech recognition.
                                                                  In Sixth International Conference on Spoken Lan-
word segmentation, which is capable of encod-                     guage Processing, ICSLP 2000 / INTERSPEECH
ing open vocabularies with a compact symbol vo-                   2000, pages 401–404, Beijing, China.
cabulary of variable-length subword units. We
show performance gains over the baseline with                  Jan A. Botha and Phil Blunsom. 2014. Compositional
both BPE segmentation, and a simple character bi-                 Morphology for Word Representations and Lan-
                                                                  guage Modelling. In Proceedings of the 31st Inter-
gram segmentation.                                                national Conference on Machine Learning (ICML),
   Our analysis shows that not only out-of-                       Beijing, China.
vocabulary words, but also rare in-vocabulary
words are translated poorly by our baseline NMT                Rohan Chitnis and John DeNero. 2015. Variable-
                                                                 Length Word Encodings for Neural Translation
  14
    The source code of the segmentation algorithms               Models. In Proceedings of the 2015 Conference on
is available at https://github.com/rsennrich/                    Empirical Methods in Natural Language Processing
subword-nmt.                                                     (EMNLP).
Kyunghyun Cho, Bart van Merrienboer, Caglar Gul-         Philipp Koehn and Kevin Knight. 2003. Empirical
  cehre, Dzmitry Bahdanau, Fethi Bougares, Hol-            Methods for Compound Splitting. In EACL ’03:
  ger Schwenk, and Yoshua Bengio. 2014. Learn-             Proceedings of the Tenth Conference on European
  ing Phrase Representations using RNN Encoder–            Chapter of the Association for Computational Lin-
  Decoder for Statistical Machine Translation. In Pro-     guistics, pages 187–193, Budapest, Hungary. Asso-
  ceedings of the 2014 Conference on Empirical Meth-       ciation for Computational Linguistics.
  ods in Natural Language Processing (EMNLP),
  pages 1724–1734, Doha, Qatar. Association for          Philipp Koehn, Hieu Hoang, Alexandra Birch, Chris
  Computational Linguistics.                               Callison-Burch, Marcello Federico, Nicola Bertoldi,
                                                           Brooke Cowan, Wade Shen, Christine Moran,
Mathias Creutz and Krista Lagus. 2002. Unsupervised        Richard Zens, Chris Dyer, Ondřej Bojar, Alexandra
 Discovery of Morphemes. In Proceedings of the             Constantin, and Evan Herbst. 2007. Moses: Open
 ACL-02 Workshop on Morphological and Phonolog-            Source Toolkit for Statistical Machine Translation.
 ical Learning, pages 21–30. Association for Compu-        In Proceedings of the ACL-2007 Demo and Poster
 tational Linguistics.                                     Sessions, pages 177–180, Prague, Czech Republic.
                                                           Association for Computational Linguistics.
Nadir Durrani, Hassan Sajjad, Hieu Hoang, and Philipp
                                                         Franklin M. Liang. 1983. Word hy-phen-a-tion by
  Koehn. 2014. Integrating an Unsupervised Translit-
                                                           com-put-er. Ph.D. thesis, Stanford University, De-
  eration Model into Statistical Machine Translation.
                                                           partment of Linguistics, Stanford, CA.
  In Proceedings of the 14th Conference of the Euro-
  pean Chapter of the Association for Computational      Wang Ling, Chris Dyer, Alan W. Black, Isabel Tran-
  Linguistics, EACL 2014, pages 148–153, Gothen-           coso, Ramon Fermandez, Silvio Amir, Luis Marujo,
  burg, Sweden.                                            and Tiago Luis. 2015a. Finding Function in Form:
                                                           Compositional Character Models for Open Vocab-
Chris Dyer, Victor Chahuneau, and Noah A. Smith.           ulary Word Representation. In Proceedings of the
  2013. A Simple, Fast, and Effective Reparame-            2015 Conference on Empirical Methods in Natu-
  terization of IBM Model 2. In Proceedings of the         ral Language Processing (EMNLP), pages 1520–
  2013 Conference of the North American Chapter of         1530, Lisbon, Portugal. Association for Computa-
  the Association for Computational Linguistics: Hu-       tional Linguistics.
  man Language Technologies, pages 644–648, At-
  lanta, Georgia. Association for Computational Lin-     Wang Ling, Isabel Trancoso, Chris Dyer, and Alan W.
  guistics.                                                Black. 2015b. Character-based Neural Machine
                                                           Translation. ArXiv e-prints, November.
Philip Gage. 1994. A New Algorithm for Data Com-
  pression. C Users J., 12(2):23–38, February.           Thang Luong, Richard Socher, and Christopher D.
                                                           Manning. 2013. Better Word Representations
Barry Haddow, Matthias Huck, Alexandra Birch, Niko-        with Recursive Neural Networks for Morphology.
  lay Bogoychev, and Philipp Koehn. 2015. The              In Proceedings of the Seventeenth Conference on
  Edinburgh/JHU Phrase-based Machine Translation           Computational Natural Language Learning, CoNLL
  Systems for WMT 2015. In Proceedings of the              2013, Sofia, Bulgaria, August 8-9, 2013, pages 104–
  Tenth Workshop on Statistical Machine Translation,       113.
  pages 126–133, Lisbon, Portugal. Association for
  Computational Linguistics.                             Thang Luong, Hieu Pham, and Christopher D. Man-
                                                           ning. 2015a. Effective Approaches to Attention-
                                                           based Neural Machine Translation. In Proceed-
Sébastien Jean, Kyunghyun Cho, Roland Memisevic,
                                                           ings of the 2015 Conference on Empirical Meth-
  and Yoshua Bengio. 2015. On Using Very Large
                                                           ods in Natural Language Processing, pages 1412–
  Target Vocabulary for Neural Machine Translation.
                                                           1421, Lisbon, Portugal. Association for Computa-
  In Proceedings of the 53rd Annual Meeting of the
                                                           tional Linguistics.
  Association for Computational Linguistics and the
  7th International Joint Conference on Natural Lan-     Thang Luong, Ilya Sutskever, Quoc Le, Oriol Vinyals,
  guage Processing (Volume 1: Long Papers), pages          and Wojciech Zaremba. 2015b. Addressing the
  1–10, Beijing, China. Association for Computa-           Rare Word Problem in Neural Machine Translation.
  tional Linguistics.                                      In Proceedings of the 53rd Annual Meeting of the
                                                           Association for Computational Linguistics and the
Nal Kalchbrenner and Phil Blunsom. 2013. Recurrent         7th International Joint Conference on Natural Lan-
  Continuous Translation Models. In Proceedings of         guage Processing (Volume 1: Long Papers), pages
  the 2013 Conference on Empirical Methods in Nat-         11–19, Beijing, China. Association for Computa-
  ural Language Processing, Seattle. Association for       tional Linguistics.
  Computational Linguistics.
                                                         Tomas Mikolov, Ilya Sutskever, Anoop Deoras, Hai-
Yoon Kim, Yacine Jernite, David Sontag, and Alexan-        Son Le, Stefan Kombrink, and Jan Cernocký. 2012.
  der M. Rush. 2015. Character-Aware Neural Lan-           Subword Language Modeling with Neural Net-
  guage Models. CoRR, abs/1508.06615.                      works. Unpublished.
Graham Neubig, Taro Watanabe, Shinsuke Mori, and          Jörg Tiedemann. 2012. Character-Based Pivot Trans-
  Tatsuya Kawahara. 2012. Machine Translation                lation for Under-Resourced Languages and Do-
  without Words through Substring Alignment. In The          mains. In Proceedings of the 13th Conference of the
  50th Annual Meeting of the Association for Compu-          European Chapter of the Association for Computa-
  tational Linguistics, Proceedings of the Conference,       tional Linguistics, pages 141–151, Avignon, France.
  July 8-14, 2012, Jeju Island, Korea - Volume 1: Long       Association for Computational Linguistics.
  Papers, pages 165–174.
                                                          David Vilar, Jan-Thorsten Peter, and Hermann Ney.
Sonja Nießen and Hermann Ney. 2000. Improving               2007. Can We Translate Letters? In Second Work-
  SMT quality with morpho-syntactic analysis. In            shop on Statistical Machine Translation, pages 33–
  18th Int. Conf. on Computational Linguistics, pages       39, Prague, Czech Republic. Association for Com-
  1081–1085.                                                putational Linguistics.
Razvan Pascanu, Tomas Mikolov, and Yoshua Ben-            Sami Virpioja, Jaakko J. Väyrynen, Mathias Creutz,
  gio. 2013. On the difficulty of training recurrent        and Markus Sadeniemi. 2007. Morphology-Aware
  neural networks. In Proceedings of the 30th Inter-        Statistical Machine Translation Based on Morphs
  national Conference on Machine Learning, ICML             Induced in an Unsupervised Manner. In Proceed-
  2013, pages 1310–1318, Atlanta, USA.                      ings of the Machine Translation Summit XI, pages
                                                            491–498, Copenhagen, Denmark.
Maja Popović. 2015. chrF: character n-gram F-score
 for automatic MT evaluation. In Proceedings of the       Matthew D. Zeiler. 2012. ADADELTA: An Adaptive
 Tenth Workshop on Statistical Machine Translation,        Learning Rate Method. CoRR, abs/1212.5701.
 pages 392–395, Lisbon, Portugal. Association for
 Computational Linguistics.
Rico Sennrich and Barry Haddow. 2015. A Joint
  Dependency Model of Morphological and Syntac-
  tic Structure for Statistical Machine Translation. In
  Proceedings of the 2015 Conference on Empirical
  Methods in Natural Language Processing, pages
  2081–2087, Lisbon, Portugal. Association for Com-
  putational Linguistics.
Benjamin Snyder and Regina Barzilay. 2008. Unsu-
  pervised Multilingual Learning for Morphological
  Segmentation. In Proceedings of ACL-08: HLT,
  pages 737–745, Columbus, Ohio. Association for
  Computational Linguistics.
David Stallard, Jacob Devlin, Michael Kayser,
  Yoong Keok Lee, and Regina Barzilay. 2012. Unsu-
  pervised Morphology Rivals Supervised Morphol-
  ogy for Arabic MT. In The 50th Annual Meeting of
  the Association for Computational Linguistics, Pro-
  ceedings of the Conference, July 8-14, 2012, Jeju
  Island, Korea - Volume 2: Short Papers, pages 322–
  327.
Miloš Stanojević, Amir Kamran, Philipp Koehn, and
  Ondřej Bojar. 2015. Results of the WMT15 Met-
  rics Shared Task. In Proceedings of the Tenth Work-
  shop on Statistical Machine Translation, pages 256–
  273, Lisbon, Portugal. Association for Computa-
  tional Linguistics.
Ilya Sutskever, Oriol Vinyals, and Quoc V. Le. 2014.
   Sequence to Sequence Learning with Neural Net-
   works. In Advances in Neural Information Process-
   ing Systems 27: Annual Conference on Neural Infor-
   mation Processing Systems 2014, pages 3104–3112,
   Montreal, Quebec, Canada.
Jörg Tiedemann. 2009. Character-based PSMT for
   Closely Related Languages. In Proceedings of 13th
   Annual Conference of the European Association for
   Machine Translation (EAMT’09), pages 12–19.
