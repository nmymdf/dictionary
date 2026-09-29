// 原型用的假資料。之後會換成本機資料庫（IndexedDB）裡的真實資料。
(function () {
  const DAY = 86400000;
  const now = Date.now();
  const ago = (d, h = 0) => now - d * DAY - h * 3600000;

  // 一個 entry = 一張卡（單字或句子）
  // group：同組易混淆字的 id;tags：匯入時的檔名編號
  const entries = [
    {
      id: 'affect', type: 'word', text: 'affect', ipa: '/əˈfekt/',
      senses: [
        { pos: 'v.', zh: '影響；使感動' },
        { pos: 'n.', zh: '（心理學）情感、情緒表現' },
      ],
      examples: [
        { en: 'Lack of sleep can affect your memory.', zh: '睡眠不足會影響你的記憶力。' },
        { en: 'She was deeply affected by the news.', zh: '她深受這則消息觸動。' },
      ],
      group: 'g-affect', tags: ['03'], starred: true, count: 6,
      last: ago(0, 2), added: ago(21),
      review: { status: 'learning', right: 4, wrong: 2, due: ago(0) },
    },
    {
      id: 'effect', type: 'word', text: 'effect', ipa: '/ɪˈfekt/',
      senses: [
        { pos: 'n.', zh: '效果；影響；結果' },
        { pos: 'v.', zh: '使發生、實現（正式）' },
      ],
      examples: [
        { en: 'The new law had little effect on prices.', zh: '新法對物價幾乎沒有影響。' },
        { en: 'The medicine takes effect in about an hour.', zh: '這藥大約一小時後生效。' },
      ],
      group: 'g-affect', tags: ['03'], starred: true, count: 4,
      last: ago(1), added: ago(21),
      review: { status: 'learning', right: 3, wrong: 1, due: ago(0) },
    },
    {
      id: 'adapt', type: 'word', text: 'adapt', ipa: '/əˈdæpt/',
      senses: [
        { pos: 'v.', zh: '適應；調整' },
        { pos: 'v.', zh: '改編（小說、劇本）' },
      ],
      examples: [
        { en: 'It took him a year to adapt to the new job.', zh: '他花了一年才適應新工作。' },
        { en: 'The novel was adapted for television.', zh: '這部小說被改編成電視劇。' },
      ],
      group: 'g-adapt', tags: ['07'], starred: true, count: 5,
      last: ago(0, 5), added: ago(14),
      review: { status: 'new', right: 0, wrong: 0, due: ago(0) },
    },
    {
      id: 'adopt', type: 'word', text: 'adopt', ipa: '/əˈdɑːpt/',
      senses: [
        { pos: 'v.', zh: '採用；採納' },
        { pos: 'v.', zh: '收養；領養' },
      ],
      examples: [
        { en: 'The company adopted a four-day work week.', zh: '公司採用了每週工作四天的制度。' },
        { en: 'They adopted a cat from the shelter.', zh: '他們從收容所領養了一隻貓。' },
      ],
      group: 'g-adapt', tags: ['07'], starred: true, count: 3,
      last: ago(2), added: ago(14),
      review: { status: 'learning', right: 2, wrong: 2, due: ago(0) },
    },
    {
      id: 'adept', type: 'word', text: 'adept', ipa: '/əˈdept/',
      senses: [{ pos: 'adj.', zh: '熟練的；擅長的' }],
      examples: [
        { en: 'She is adept at handling difficult customers.', zh: '她很擅長應付難搞的客人。' },
      ],
      group: 'g-adapt', tags: ['07'], starred: false, count: 1,
      last: ago(9), added: ago(14),
      review: { status: 'none', right: 0, wrong: 0, due: null },
    },
    {
      id: 'principle', type: 'word', text: 'principle', ipa: '/ˈprɪnsəpl/',
      senses: [
        { pos: 'n.', zh: '原則；原理' },
        { pos: 'n.', zh: '（道德）準則、信條' },
      ],
      examples: [
        { en: 'The basic principle is simple.', zh: '基本原理很簡單。' },
        { en: 'He refused on principle.', zh: '他基於原則拒絕了。' },
      ],
      group: 'g-principle', tags: ['12'], starred: true, count: 2,
      last: ago(3), added: ago(10),
      review: { status: 'mastered', right: 6, wrong: 0, due: ago(-5) },
    },
    {
      id: 'principal', type: 'word', text: 'principal', ipa: '/ˈprɪnsəpl/',
      senses: [
        { pos: 'n.', zh: '校長；負責人' },
        { pos: 'adj.', zh: '主要的；首要的' },
      ],
      examples: [
        { en: 'The principal called a meeting with the parents.', zh: '校長召集家長開會。' },
        { en: 'Tourism is the principal source of income here.', zh: '觀光是這裡主要的收入來源。' },
      ],
      group: 'g-principle', tags: ['12'], starred: true, count: 2,
      last: ago(3), added: ago(10),
      review: { status: 'learning', right: 1, wrong: 1, due: ago(0) },
    },
    {
      id: 'complement', type: 'word', text: 'complement', ipa: '/ˈkɑːmplɪment/',
      senses: [
        { pos: 'v.', zh: '補充；使完美、相得益彰' },
        { pos: 'n.', zh: '補充物；（文法）補語' },
      ],
      examples: [
        { en: 'The wine complements the fish perfectly.', zh: '這款酒和魚搭配得恰到好處。' },
      ],
      group: 'g-compliment', tags: ['12'], starred: false, count: 1,
      last: ago(6), added: ago(10),
      review: { status: 'none', right: 0, wrong: 0, due: null },
    },
    {
      id: 'compliment', type: 'word', text: 'compliment', ipa: '/ˈkɑːmplɪmənt/',
      senses: [
        { pos: 'n.', zh: '讚美；恭維' },
        { pos: 'v.', zh: '稱讚' },
      ],
      examples: [
        { en: 'She complimented him on his cooking.', zh: '她稱讚他的廚藝。' },
      ],
      group: 'g-compliment', tags: ['12'], starred: true, count: 2,
      last: ago(6), added: ago(10),
      review: { status: 'new', right: 0, wrong: 0, due: ago(0) },
    },
    {
      // 這個檔沒有音標（有些舊單字簿沒有）
      id: 'economic', type: 'word', text: 'economic', ipa: '',
      senses: [{ pos: 'adj.', zh: '經濟的；經濟上的' }],
      examples: [
        { en: 'The country is facing economic problems.', zh: '這個國家正面臨經濟問題。' },
      ],
      group: 'g-economic', tags: ['18'], starred: false, count: 1,
      last: ago(12), added: ago(12),
      review: { status: 'none', right: 0, wrong: 0, due: null },
    },
    {
      id: 'economical', type: 'word', text: 'economical', ipa: '',
      senses: [{ pos: 'adj.', zh: '節省的；划算的' }],
      examples: [
        { en: 'This car is very economical on fuel.', zh: '這台車非常省油。' },
      ],
      group: 'g-economic', tags: ['18'], starred: true, count: 3,
      last: ago(4), added: ago(12),
      review: { status: 'learning', right: 2, wrong: 1, due: ago(0) },
    },
    {
      id: 'meticulous', type: 'word', text: 'meticulous', ipa: '/məˈtɪkjələs/',
      senses: [{ pos: 'adj.', zh: '一絲不苟的；極仔細的' }],
      examples: [
        { en: 'He keeps meticulous records of his expenses.', zh: '他把開銷記錄得一絲不苟。' },
      ],
      group: null, tags: [], starred: true, count: 2,
      last: ago(0, 1), added: ago(0, 1),
      review: { status: 'new', right: 0, wrong: 0, due: ago(0) },
    },
    {
      id: 'resilient', type: 'word', text: 'resilient', ipa: '/rɪˈzɪliənt/',
      senses: [{ pos: 'adj.', zh: '有韌性的；能迅速恢復的' }],
      examples: [
        { en: 'Children are often more resilient than adults.', zh: '孩子往往比大人更有韌性。' },
      ],
      group: null, tags: [], starred: false, count: 1,
      last: ago(1, 3), added: ago(1, 3),
      review: { status: 'none', right: 0, wrong: 0, due: null },
    },
    {
      id: 's-policy', type: 'sentence',
      text: 'The new policy will affect how quickly teams adopt new tools.',
      zh: '新政策會影響團隊採用新工具的速度。',
      tags: [], starred: true, count: 2, last: ago(0, 3), added: ago(2),
      review: { status: 'new', right: 0, wrong: 0, due: ago(0) },
    },
    {
      id: 's-adept', type: 'sentence',
      text: 'She is adept at adapting to sudden changes.',
      zh: '她很擅長適應突如其來的變化。',
      tags: [], starred: false, count: 1, last: ago(5), added: ago(5),
      review: { status: 'none', right: 0, wrong: 0, due: null },
    },
  ];

  const groups = {
    'g-affect': { name: 'affect / effect', note: 'affect 多當動詞「影響」；effect 多當名詞「效果、影響」。', members: ['affect', 'effect'] },
    'g-adapt': { name: 'adapt / adopt / adept', note: 'adapt 適應、adopt 採用/領養、adept 擅長的（形容詞）。', members: ['adapt', 'adopt', 'adept'] },
    'g-principle': { name: 'principle / principal', note: 'principle 原則；principal 校長、主要的。', members: ['principle', 'principal'] },
    'g-compliment': { name: 'complement / compliment', note: 'complement 互補；compliment 讚美（記：I like to be complimented）。', members: ['complement', 'compliment'] },
    'g-economic': { name: 'economic / economical', note: 'economic 經濟（學）上的；economical 省錢的。', members: ['economic', 'economical'] },
  };

  // 查詢紀錄（新的在前）
  const history = [
    { id: 'meticulous', at: ago(0, 1) },
    { id: 'affect', at: ago(0, 2) },
    { id: 's-policy', at: ago(0, 3) },
    { id: 'adapt', at: ago(0, 5) },
    { id: 'effect', at: ago(1) },
    { id: 'resilient', at: ago(1, 3) },
    { id: 'adopt', at: ago(2) },
    { id: 'principal', at: ago(3) },
  ];

  // 從其他 App 分享進來的示範文字
  const sharedSample = {
    text: 'Resilient teams adapt quickly and rarely procrastinate on hard decisions.',
    source: 'Chrome',
  };

  window.MOCK = { entries, groups, history, sharedSample };
})();
