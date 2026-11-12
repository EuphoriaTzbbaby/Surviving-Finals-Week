window.FZ = window.FZ || {};

FZ.MAJORS = [
  { name: '计算机科学与技术', subjects: ['数据结构', '操作系统', '编译原理', '计算机网络'] },
  { name: '临床医学', subjects: ['系统解剖学', '病理生理学', '药理学', '诊断学'] },
  { name: '法学', subjects: ['民法总论', '刑法分论', '宪法学', '民事诉讼法'] },
  { name: '汉语言文学', subjects: ['古代汉语', '文学理论', '中国现当代文学', '训诂学'] },
  { name: '数学与应用数学', subjects: ['数学分析', '实变函数', '抽象代数', '数值分析'] },
  { name: '电子信息工程', subjects: ['信号与系统', '电磁场与电磁波', '数字电路', '通信原理'] },
  { name: '工商管理', subjects: ['财务管理', '运筹学', '组织行为学', '统计学'] },
  { name: '心理学', subjects: ['心理统计学', '认知心理学', '实验心理学', '生理心理学'] },
  { name: '建筑学', subjects: ['建筑力学', '建筑设计', '建筑史', '城市规划原理'] },
  { name: '英语', subjects: ['高级英语', '语言学导论', '英美文学', '同声传译'] },
  { name: '机械工程', subjects: ['材料力学', '机械原理', '热力学', '公差配合'] },
  { name: '新闻传播学', subjects: ['传播学理论', '新闻采写', '媒介史', '数据新闻'] }
];

FZ.DIFFICULTY = {
  easy:   { key: 'easy',   name: '佛系', desc: '老师划了重点，遗忘慢', decay: 0.13, recover: 24, swing: 4,  penalty: 0.85 },
  normal: { key: 'normal', name: '标准', desc: '正常期末周，该背的得背', decay: 0.17, recover: 19, swing: 7,  penalty: 1.0 },
  hard:   { key: 'hard',   name: '卷王', desc: '闭卷、无重点、全班排名', decay: 0.22, recover: 14, swing: 11, penalty: 1.35 }
};

FZ.BALANCE = {
  start: { k: 18, s: 85, m: 70, n: 30 },
  kScale: 0.62,
  focusBonus: 1.2,
  focusCap: 5,
  lowStamina: 25,
  lowMind: 25,
  collapseAt: 8,
  burnoutAt: 8,
  distractedChance: 0.3,
  distractedLoss: 4,
  kCoef: 0.85,
  staminaGate: [[45, 4], [25, 0], [0, -10]],
  mindGate: [[55, 5], [30, 0], [0, -12]],
  netGate: [[60, 4], [40, 2], [0, 0]],
  tiredFocus: 4,
  tiredFactor: 0.6,
  mindSleep: 7,
  socialTipAt: 72
};

FZ.SLOTS = [
  { key: 'morning',   name: '早', time: '08:20', full: '清晨' },
  { key: 'afternoon', name: '中', time: '14:05', full: '午后' },
  { key: 'night',     name: '晚', time: '23:40', full: '深夜' }
];

FZ.STATS = [
  { key: 'k', name: '知识', color: '#B6F03C', desc: '脑子里真正装进去的东西' },
  { key: 's', name: '体力', color: '#FFB020', desc: '撑住下一场通宵的本钱' },
  { key: 'm', name: '心态', color: '#FF3D8B', desc: '崩了就什么都记不住' },
  { key: 'n', name: '人脉', color: '#35D6F5', desc: '关键时刻有人递来重点' }
];

FZ.EVENTS = [
  {
    id: 'm1', slot: 'morning', scene: 'library', title: '七点二十的图书馆',
    text: '闸机还没开，门口已经排了三十多人。你手里攥着校园卡，前面那个人带了折叠凳。离{科目}考试还有三天。',
    choices: [
      { label: '排在队伍里，背单词卡', tag: '卷', study: true, fx: { k: 7, s: -6, m: -3 }, result: '队伍挪得很慢，但你确实背完了两页。膝盖有点酸。' },
      { label: '去空教室，没人抢', tag: '稳', study: true, fx: { k: 9, s: -8, m: 4 }, result: '空教室的灯管有点闪，但整张桌子都是你的。效率意外地高。' },
      { label: '回宿舍再睡四十分钟', tag: '躺', fx: { s: 16, m: 8, k: -3 }, result: '四十分钟变成了一小时二十。醒来时世界很安静，你有点心虚。' }
    ]
  },
  {
    id: 'm2', slot: 'morning', scene: 'classroom', title: '早八点名',
    text: '这门课不考，但老师说了平时分占三成。教室在六楼，你昨晚两点才睡，{科目}一个字没看。',
    choices: [
      { label: '去，坐后排偷偷复习', tag: '卷', study: true, fx: { k: 6, s: -10, m: -4 }, result: '老师念到你名字时你答了"到"，同时翻过一页{科目}。 multitasking 达成。' },
      { label: '去，认真听这门课', tag: '稳', fx: { k: 3, s: -7, m: 7, n: 4 }, result: '意外挺有意思。旁边同学借了你一支笔，加了微信。' },
      { label: '不去，让室友帮忙答到', tag: '险', requires: { n: 35 }, fx: { k: 10, s: 4, m: -6 }, result: '室友回了个"OK"的手势。你在宿舍多刷了一套{科目}真题，心里有点悬。' }
    ]
  },
  {
    id: 'm3', slot: 'morning', scene: 'dorm', title: '闹钟响了第六次',
    text: '手机屏幕上六个闹钟全被按掉了。宿舍窗帘缝里透进一条白光，室友的键盘声已经响了两小时。',
    choices: [
      { label: '猛地坐起来，冷水洗脸', tag: '卷', study: true, fx: { k: 5, s: -4, m: 6 }, result: '冷水下去整个人清醒了。你给自己写了张便签：今天必须过三章。' },
      { label: '躺着把网课当播客听', tag: '躺', study: true, fx: { k: 4, s: 6, m: 2 }, result: '半梦半醒间听进去几个名词。醒来得倒回去重听一遍。' },
      { label: '起来给室友带份早餐', tag: '友', fx: { n: 12, m: 9, s: -3, k: -2 }, result: '室友感动得不行，说晚上把{科目}的笔记借你。这波不亏。' }
    ]
  },
  {
    id: 'm4', slot: 'morning', scene: 'canteen', title: '早餐窗口只剩两个',
    text: '一个卖包子，一个卖煎饼。排队的人都盯着手机里的{科目}课件。你兜里还剩十七块。',
    choices: [
      { label: '煎饼加双蛋，吃饱再战', tag: '稳', fx: { s: 14, m: 6, k: -1 }, result: '热量到位，脑子终于开始转了。煎饼阿姨还多给了你一片薄脆。' },
      { label: '买个包子边走边背', tag: '卷', study: true, fx: { k: 6, s: 5, m: -2 }, result: '一手包子一手打印稿，酱汁滴在了第三章的重点上。你把它当成荧光笔。' },
      { label: '不吃，省钱买咖啡', tag: '险', fx: { s: -6, m: 3, k: 4 }, result: '咖啡因上来了，胃在抗议。你决定中午补回来。' }
    ]
  },
  {
    id: 'm5', slot: 'morning', scene: 'print', title: '打印店的长队',
    text: '期末周的打印店是全校最卷的地方。前面的人在印四百页的{科目}历年卷，机器咔咔响。',
    choices: [
      { label: '排队，把历年卷全印了', tag: '卷', study: true, fx: { k: 11, s: -9, m: -3 }, result: '你抱着一摞还温热的纸走出打印店，有种装备齐全的错觉。' },
      { label: '在等的时候问前面的人借重点', tag: '友', requires: { n: 25 }, fx: { n: 10, k: 7, m: 5, s: -5 }, result: '对方是上一届的学长，直接把他自己整理的十二页重点发你了。' },
      { label: '不印了，用平板看', tag: '躺', fx: { k: 4, s: 3, m: -4 }, result: '平板翻页确实方便，但看到第二十页你就开始切别的 App 了。' }
    ]
  },
  {
    id: 'm6', slot: 'morning', scene: 'classroom', title: '学霸的笔记',
    text: '前排那位从不缺课的同学正在整理笔记，字迹工整得像印刷体。{科目}最关键的那一章，他标了三种颜色。',
    choices: [
      { label: '直接开口借来复印', tag: '友', requires: { n: 30 }, fx: { k: 14, n: 6, m: 6, s: -6 }, result: '他犹豫了两秒还是递过来了。三种颜色分别代表：必考、可能考、他也没懂。' },
      { label: '坐过去一起复习', tag: '友', study: true, fx: { k: 10, n: 10, m: 4, s: -10 }, result: '他讲题比你听网课快多了。你请他喝了瓶水，算是学费。' },
      { label: '算了，自己啃书', tag: '卷', study: true, fx: { k: 8, m: -5, s: -9 }, result: '自己啃确实更扎实，但那一章你啃了整个上午还没啃完。' }
    ]
  },
  {
    id: 'm7', slot: 'morning', scene: 'library', title: '桌上的占座纸条',
    text: '你昨天贴的占座纸条被人撕了，位置上坐着陌生人和他的三本{科目}参考书。',
    choices: [
      { label: '理论，这是你的位置', tag: '险', fx: { m: -12, s: -5, k: -2, n: -4 }, result: '对方说"桌上又没写名字"。你争了两句，最后各退一步共用桌子，气压很低。' },
      { label: '换位置，别浪费时间', tag: '稳', study: true, fx: { k: 8, m: 3, s: -7 }, result: '你搬到窗边的位置，光线更好。心态没被消耗，这波是赚的。' },
      { label: '干脆和他拼桌互相提问', tag: '友', fx: { k: 9, n: 12, m: 6, s: -8 }, result: '聊了两句发现你们考同一门。互相抽查了半小时，比一个人背有效。' }
    ]
  },
  {
    id: 'm8', slot: 'morning', scene: 'canteen', title: '咖啡的第三杯',
    text: '这是你今天的第三杯。心悸已经开始了，但{科目}还有两章没动。',
    choices: [
      { label: '再来一杯，今天必须过完', tag: '险', study: true, fx: { k: 12, s: -16, m: -8 }, result: '手在抖，但书确实翻过去了。你能听见自己的心跳。' },
      { label: '换成温水，缓一缓', tag: '稳', fx: { s: 12, m: 8, k: 2 }, result: '心跳慢慢平下来。你发现刚才那两页其实没记住，重新看了一遍。' },
      { label: '去操场走两圈', tag: '躺', fx: { s: 15, m: 12, k: -2 }, result: '冷空气很有用。走回来的时候你想通了一个一直没懂的推导。' }
    ]
  },
  {
    id: 'm9', slot: 'morning', scene: 'campus', title: '操场上的清醒时刻',
    text: '路过操场，有人在跑步。你已经连续坐了五个小时，腰像一块木板。',
    choices: [
      { label: '跑两公里再回去', tag: '稳', fx: { s: 18, m: 14, k: -3 }, result: '跑完洗了个脸，整个人重启了。后面两小时效率翻倍。' },
      { label: '站着背书，一举两得', tag: '卷', study: true, fx: { k: 8, s: 4, m: 3 }, result: '站着背确实不容易困。路过的人以为你在打电话。' },
      { label: '直接回自习室继续', tag: '卷', study: true, fx: { k: 10, s: -12, m: -5 }, result: '腰更疼了，但你把那一节推完了。代价是下午一直想趴着。' }
    ]
  },
  {
    id: 'm10', slot: 'morning', scene: 'online', title: '小组作业的催命消息',
    text: '群里 @了全体：另一门课的小组作业今晚交，你负责的部分还没写。{科目}也还没复习完。',
    choices: [
      { label: '先把作业写完，做个靠谱的人', tag: '友', fx: { n: 14, m: 5, k: -4, s: -9 }, result: '你按时交了，群里一片"辛苦了"。有人说下次考试请你吃饭。' },
      { label: '和组员说明情况，换一部分', tag: '稳', requires: { n: 30 }, fx: { n: 5, m: 8, k: 5, s: -5 }, result: '组员很爽快地接了过去，说你先顾考试。你欠了一顿奶茶。' },
      { label: '拖到晚上，先复习', tag: '险', study: true, fx: { k: 11, n: -12, m: -7, s: -8 }, result: '{科目}推进了一大截，但群里已经开始有人阴阳怪气了。' }
    ]
  },
  {
    id: 'm11', slot: 'morning', scene: 'classroom', title: '老师突然划重点',
    text: '课前五分钟，老师随口说了句"这次{科目}的大题就出在这几章"。全班瞬间坐直。',
    choices: [
      { label: '全录下来，逐字整理', tag: '卷', study: true, fx: { k: 16, s: -8, m: 8 }, result: '你整理出一份精确到页码的清单。这是三天里最值的四十分钟。' },
      { label: '只记关键词，其余自己判断', tag: '稳', study: true, fx: { k: 10, s: -4, m: 5 }, result: '记了六个关键词，回来对照目录圈了范围。够用。' },
      { label: '发到群里，换别人的笔记', tag: '友', fx: { k: 9, n: 14, m: 6, s: -4 }, result: '群里炸了。半小时后你收到三份不同版本的整理，比自己的全。' }
    ]
  },
  {
    id: 'm12', slot: 'morning', scene: 'online', title: '手机推送：成绩出了',
    text: '另一门课的成绩出来了。你点开之前手指停在屏幕上，{科目}的书还摊在腿上。',
    choices: [
      { label: '立刻点开', tag: '险', fx: { m: -10, k: -2, s: -2 }, result: '比预想的低八分。你盯着那个数字看了很久，书一个字没进。' },
      { label: '考完再看，关掉推送', tag: '稳', study: true, fx: { k: 9, m: 6, s: -6 }, result: '关掉通知的瞬间世界安静了。你多看了两节，心里踏实。' },
      { label: '找同学一起点，互相安慰', tag: '友', fx: { m: 8, n: 10, k: 3, s: -4 }, result: '两个人一起看，结果都还行。吐槽了十分钟，情绪消化掉了。' }
    ]
  },

  {
    id: 'a1', slot: 'afternoon', scene: 'canteen', title: '食堂偶遇学长',
    text: '打饭时排在你前面的学长去年{科目}考了九十四。他端着餐盘正在找位置。',
    choices: [
      { label: '端着盘子坐过去请教', tag: '友', requires: { n: 20 }, fx: { k: 15, n: 12, m: 8, s: -4 }, result: '他给你讲了三个必考题型和两个千万别踩的坑。这顿饭吃得极值。' },
      { label: '加个微信，晚点再问', tag: '友', fx: { n: 14, m: 5, k: 3, s: 2 }, result: '加上了。他回了句"晚上有空"，你心里有了底。' },
      { label: '自己吃，顺便刷两节课', tag: '卷', study: true, fx: { k: 7, s: 8, m: -3 }, result: '边吃边看，饭凉了。网课进度条前进了一格。' }
    ]
  },
  {
    id: 'a2', slot: 'afternoon', scene: 'library', title: '自习室的空调',
    text: '空调坏了，室温二十九度。周围一片扇子声，{科目}的公式在眼前晃。',
    choices: [
      { label: '换到地下自习室', tag: '稳', study: true, fx: { k: 11, s: -6, m: 6 }, result: '地下凉快，但信号差。你被迫专心，效率反而高了。' },
      { label: '硬扛，不想挪窝', tag: '卷', study: true, fx: { k: 8, s: -14, m: -8 }, result: '汗把打印稿洇湿了一角。你看完了，但记住的不多。' },
      { label: '买根冰棍，休息二十分钟', tag: '躺', fx: { s: 13, m: 12, k: -2 }, result: '冰棍两块钱，快乐十分钟。回去之后公式终于不晃了。' }
    ]
  },
  {
    id: 'a3', slot: 'afternoon', scene: 'campus', title: '社团的最后一次活动',
    text: '这学期社团最后一次活动，有蛋糕和合影。你不去也没人说你，但{科目}还剩四章。',
    choices: [
      { label: '去，待一小时就回', tag: '友', fx: { n: 15, m: 16, s: -5, k: -3 }, result: '合影里你笑得很真。回来之后心情好得能多做两套题。' },
      { label: '完全不去，泡在自习室', tag: '卷', study: true, fx: { k: 13, n: -8, m: -10, s: -10 }, result: '四章推进了两章。群里合影刷过去的时候你把手机扣在了桌上。' },
      { label: '露个面，带书去后台看', tag: '险', study: true, fx: { k: 6, n: 7, m: 4, s: -8 }, result: '你在后台看了半小时书，被拉去拍了照。两边都没落下，也都没做好。' }
    ]
  },
  {
    id: 'a4', slot: 'afternoon', scene: 'online', title: '网课的两倍速',
    text: '{科目}的复习课录像还有三小时。进度条看着就让人绝望，弹幕里全是"救命"。',
    choices: [
      { label: '两倍速全程刷完', tag: '卷', study: true, fx: { k: 13, s: -12, m: -6 }, result: '刷完了，脑子像被高速冲过一遍。笔记记了满满四页，字迹潦草。' },
      { label: '只看考的那几节，正常速', tag: '稳', study: true, fx: { k: 12, s: -6, m: 4 }, result: '你按重点清单挑着看，理解得比刷完更透。这才是正确用法。' },
      { label: '先做一套题，遇到不会再回看', tag: '卷', study: true, fx: { k: 15, s: -11, m: -3 }, result: '做题暴露了三个盲区，你精准回看。这是今天最高效的两小时。' }
    ]
  },
  {
    id: 'a5', slot: 'afternoon', scene: 'classroom', title: '实验报告还差一份',
    text: '{专业}的实验报告今晚截止，数据你早就测完了，只差分析和图表。',
    choices: [
      { label: '认真做完，图表画漂亮', tag: '稳', fx: { k: 6, n: 6, m: 6, s: -12 }, result: '报告交上去，助教回了个"做得不错"。虽然花了时间，但心里干净。' },
      { label: '快速交一版能过的', tag: '险', fx: { k: 3, m: 3, s: -5, n: -3 }, result: '半小时搞定。你知道分析写得很水，但至少不扣分了。' },
      { label: '先放着，全力复习', tag: '卷', study: true, fx: { k: 14, m: -8, n: -6, s: -9 }, result: '{科目}推进明显，但报告的事一直在后台占着你的内存。' }
    ]
  },
  {
    id: 'a6', slot: 'afternoon', scene: 'library', title: '闭馆音乐提前响起',
    text: '图书馆广播说今天设备检修，提前一小时闭馆。你的{科目}专题刚看到关键处。',
    choices: [
      { label: '转战通宵自习室', tag: '卷', study: true, fx: { k: 12, s: -10, m: -4 }, result: '通宵室灯光惨白，但没人说话。你把那个专题啃完了。' },
      { label: '回宿舍，环境熟悉', tag: '躺', study: true, fx: { k: 6, s: 4, m: 6 }, result: '宿舍舒服，但室友在打游戏。你看了半小时就开始加入他们的话题。' },
      { label: '去教学楼空教室', tag: '稳', study: true, fx: { k: 10, s: -5, m: 3 }, result: '整层楼只有三个人。安静得能听见自己翻书，效果意外地好。' }
    ]
  },
  {
    id: 'a7', slot: 'afternoon', scene: 'canteen', title: '朋友约火锅',
    text: '高中同学来这个城市了，约你晚上吃火锅。他说"就今晚有空"。{科目}还有两天。',
    choices: [
      { label: '去，两小时就回来', tag: '友', fx: { m: 20, n: 14, s: -6, k: -5 }, result: '聊了很多以前的事。回来的路上你觉得自己又像个活人了。' },
      { label: '婉拒，考完再约', tag: '卷', study: true, fx: { k: 14, m: -12, n: -6, s: -9 }, result: '他说"理解"。你放下手机继续看书，但那句"理解"让你有点难受。' },
      { label: '改成宵夜，压缩到一小时', tag: '险', fx: { m: 11, n: 8, k: 5, s: -10 }, result: '你们约在十一点。见了面也复习了，只是两边都很赶。' }
    ]
  },
  {
    id: 'a8', slot: 'afternoon', scene: 'online', title: '论文查重百分之三十八',
    text: '另一门课的论文查重结果出来了，百分之三十八，红线是二十。{科目}的书还摊在旁边。',
    choices: [
      { label: '立刻逐段改写', tag: '稳', fx: { k: 4, m: 6, s: -14, n: 2 }, result: '改了两个小时降到十九。眼睛很酸，但这颗雷排掉了。' },
      { label: '找学长问降重技巧', tag: '友', requires: { n: 40 }, fx: { k: 5, n: 6, m: 10, s: -7 }, result: '学长给了三个句式替换的思路，四十分钟就降下来了。人脉的价值。' },
      { label: '晚上再改，先复习', tag: '险', study: true, fx: { k: 13, m: -10, s: -10 }, result: '复习推进了，但查重那件事每隔十分钟就冒出来一次。' }
    ]
  },
  {
    id: 'a9', slot: 'afternoon', scene: 'classroom', title: '突袭小测',
    text: '老师进门就说"拿出纸，测一下{科目}前四章"。教室里一片哀嚎。这不计入总分，但会公布排名。',
    choices: [
      { label: '认真做，检验真实水平', tag: '卷', study: true, fx: { k: 12, m: -6, s: -8 }, result: '错了三道，全是同一个知识点。你把它圈成了今晚的头号目标。' },
      { label: '会做的做，不会的空着', tag: '稳', study: true, fx: { k: 8, m: 4, s: -5 }, result: '你诚实地区分了"会"和"蒙对"。这份自我认知比分数有用。' },
      { label: '和同桌对着写', tag: '险', fx: { k: 3, n: 6, m: -8, s: -4 }, result: '分数好看，但你清楚自己什么都没测出来。心里那点虚一直没散。' }
    ]
  },
  {
    id: 'a10', slot: 'afternoon', scene: 'campus', title: '快递驿站的队',
    text: '你买的{科目}辅导书到了，但驿站排队要二十分钟。不带书也能复习，只是少了个抓手。',
    choices: [
      { label: '排，边排边背手上的稿子', tag: '卷', study: true, fx: { k: 9, s: -7, m: 2 }, result: '队伍里你背完了两页。拿到书的时候有种装备升级的踏实感。' },
      { label: '让室友顺手帮取', tag: '友', requires: { n: 35 }, fx: { k: 10, n: 4, m: 6, s: -4 }, result: '室友答应了，还顺便帮你带了瓶水。你省下二十分钟做了一套题。' },
      { label: '不取了，用电子版', tag: '躺', fx: { k: 5, s: 4, m: -3 }, result: '电子版能看，但你总忍不住滑到别的 App。书在驿站躺了三天。' }
    ]
  },
  {
    id: 'a11', slot: 'afternoon', scene: 'print', title: '打印机没墨了',
    text: '你排了十五分钟，轮到你时机器提示碳粉不足。后面的人开始叹气。{科目}的重点还没印出来。',
    choices: [
      { label: '换一台，重新排', tag: '稳', study: true, fx: { k: 8, s: -10, m: -6 }, result: '又排了十分钟。拿到纸的时候你已经不太想看了。' },
      { label: '拍下别人印好的重点', tag: '友', fx: { k: 11, n: 8, m: 4, s: -4 }, result: '你礼貌地问了旁边的人，对方直接让你拍。省了排队还省了钱。' },
      { label: '算了，回去看电子稿', tag: '躺', fx: { k: 4, s: 5, m: 2 }, result: '走回宿舍的路上你刷了会儿手机。电子稿打开的时间比想象中晚。' }
    ]
  },
  {
    id: 'a12', slot: 'afternoon', scene: 'online', title: '答疑群里没人说话',
    text: '{科目}的答疑群安静了一整天。你卡在一个推导上四十分钟了，发出去可能没人回。',
    choices: [
      { label: '发出去，附上自己的思路', tag: '友', fx: { k: 13, n: 10, m: 7, s: -5 }, result: '助教回了，还夸你思路清楚。卡了四十分钟的地方三分钟就通了。' },
      { label: '自己再想三十分钟', tag: '卷', study: true, fx: { k: 10, m: -7, s: -11 }, result: '你想出来了。理解很深，但代价是半小时和一堆掉的头发。' },
      { label: '先跳过，标记为待办', tag: '稳', study: true, fx: { k: 7, m: 5, s: -4 }, result: '你在便签上写下这一条，继续往后推。晚上回来时突然就懂了。' }
    ]
  },

  {
    id: 'n1', slot: 'night', scene: 'dorm', title: '通宵的岔路口',
    text: '凌晨零点四十。{科目}还剩两章，明早八点半考。室友已经睡了，台灯是你唯一的光源。',
    choices: [
      { label: '通宵，把两章过完', tag: '险', study: true, fx: { k: 17, s: -26, m: -12 }, result: '四点半你看完了最后一页。窗外开始发白，你的心跳有点乱。' },
      { label: '看到两点，睡四小时', tag: '稳', study: true, fx: { k: 11, s: -8, m: 4 }, result: '你定了三个闹钟。躺下时脑子还在自动播放公式，但确实睡着了。' },
      { label: '现在睡，明早五点起来背', tag: '险', study: true, fx: { k: 8, s: 14, m: 6 }, result: '赌明早的状态。躺下的瞬间你既安心又害怕。' }
    ]
  },
  {
    id: 'n2', slot: 'night', scene: 'dorm', title: '宿舍夜谈',
    text: '熄灯后室友突然开口："你们说我们这么卷是为了什么。"四个人都没睡，{科目}的书扣在桌上。',
    choices: [
      { label: '加入，聊到一点半', tag: '友', fx: { m: 18, n: 16, s: -8, k: -5 }, result: '聊了很多没用的话，但每个人都轻松了。这种夜晚以后会想起来。' },
      { label: '戴耳塞，继续打灯看', tag: '卷', study: true, fx: { k: 12, n: -8, m: -9, s: -12 }, result: '你多过了一章。室友后来没再说话，宿舍有点冷。' },
      { label: '聊十分钟，然后睡觉', tag: '稳', fx: { m: 10, n: 8, s: 8, k: -2 }, result: '十分钟刚好。你带着一点笑意睡了，是这三天最好的一觉。' }
    ]
  },
  {
    id: 'n3', slot: 'night', scene: 'dorm', title: '深夜突然 emo',
    text: '十一点五十，你盯着{科目}的一页看了二十分钟，一个字没进。突然觉得这一切都没什么意义。',
    choices: [
      { label: '合上书，出门走十分钟', tag: '稳', fx: { m: 20, s: 6, k: -2 }, result: '夜风很凉。你在楼下站了一会儿，回来时又能看进去了。' },
      { label: '硬看，逼自己专注', tag: '险', study: true, fx: { k: 6, m: -16, s: -13 }, result: '你确实翻过去了三页，但那种空洞感一直在。' },
      { label: '给朋友打个电话', tag: '友', requires: { n: 30 }, fx: { m: 22, n: 10, s: -4, k: -3 }, result: '朋友听你说完，说"我也一样"。这四个字比任何鸡汤都有用。' }
    ]
  },
  {
    id: 'n4', slot: 'night', scene: 'canteen', title: '宵夜的诱惑',
    text: '外卖软件推了张满减券。你已经饿了两小时，{科目}的题册摊在手边。',
    choices: [
      { label: '点一份，边吃边看', tag: '躺', study: true, fx: { s: 16, m: 10, k: 4 }, result: '热量和碳水一起到位。等的二十分钟你还做了五道题。' },
      { label: '吃泡面，五分钟解决', tag: '稳', fx: { s: 11, m: 4, k: 2 }, result: '泡面三分钟，吃完继续。效率党的选择。' },
      { label: '不吃，饿着更清醒', tag: '险', study: true, fx: { k: 10, s: -14, m: -8 }, result: '饿确实让人清醒，但半小时后开始手抖。' }
    ]
  },
  {
    id: 'n5', slot: 'night', scene: 'library', title: '台灯下的最后一页',
    text: '通宵自习室只剩七个人。你翻到{科目}重点清单的最后一页，笔尖停住了。',
    choices: [
      { label: '从头再过一遍全部重点', tag: '卷', study: true, fx: { k: 16, s: -18, m: -5 }, result: '第二遍比第一遍快得多。很多之前模糊的地方突然连起来了。' },
      { label: '只过错题本', tag: '稳', study: true, fx: { k: 13, s: -8, m: 5 }, result: '错题是最诚实的清单。你补掉了四个一直没解决的漏洞。' },
      { label: '合上书，闭眼在脑内过框架', tag: '稳', study: true, fx: { k: 9, s: 6, m: 8 }, result: '不看书反而想得更清楚。你在脑内把整门课的骨架搭了一遍。' }
    ]
  },
  {
    id: 'n6', slot: 'night', scene: 'online', title: '游戏好友上线了',
    text: '提示音响了，老朋友在线，发来一句"来一把？"。你已经复习了六小时，{科目}还剩一章。',
    choices: [
      { label: '来一把，就一把', tag: '躺', fx: { m: 16, s: -6, k: -6, n: 6 }, result: '一把变成了三把。放下手机时是凌晨一点，你有点后悔但也有点快乐。' },
      { label: '回"考完约"，继续看', tag: '卷', study: true, fx: { k: 13, m: -6, s: -11 }, result: '你过完了那一章。手机屏幕暗下去的时候，房间格外安静。' },
      { label: '约考完一起玩，现在先睡', tag: '稳', fx: { m: 10, n: 8, s: 12, k: -2 }, result: '有了考完的期待，睡觉都变得容易了。' }
    ]
  },
  {
    id: 'n7', slot: 'night', scene: 'library', title: '凌晨三点的自习室',
    text: '三点整。隔壁桌的人趴下了，对面的人在喝第四罐功能饮料。你的{科目}笔记还差最后一节。',
    choices: [
      { label: '跟着卷，把这节写完', tag: '险', study: true, fx: { k: 14, s: -22, m: -10 }, result: '写完了。抬头时天有点亮，你的眼睛干得睁不开。' },
      { label: '趴二十分钟再继续', tag: '稳', study: true, fx: { k: 9, s: 10, m: 5 }, result: '二十分钟的小睡救了你。醒来后那节只花了十五分钟。' },
      { label: '收工回去睡', tag: '躺', fx: { s: 22, m: 8, k: -3 }, result: '走回宿舍的路上空气很凉。你决定相信已经记住的部分。' }
    ]
  },
  {
    id: 'n8', slot: 'night', scene: 'dorm', title: '睡前最后一次刷手机',
    text: '躺下了，手机还在手里。短视频一条接一条，{科目}的公式在脑子里越来越模糊。',
    choices: [
      { label: '刷到困为止', tag: '躺', fx: { m: 8, s: -10, k: -7 }, result: '两点十分你终于放下手机。睡眠时间少了两小时，快乐也没多多少。' },
      { label: '放远一点，直接睡', tag: '稳', fx: { s: 20, m: 8, k: 2 }, result: '手机放到桌上了。你睡得比想的快，第二天状态明显好。' },
      { label: '把手机换成背单词 App', tag: '卷', study: true, fx: { k: 7, s: -6, m: -3 }, result: '背着背着睡着了，手机砸在脸上。至少最后一个画面是知识。' }
    ]
  },
  {
    id: 'n9', slot: 'night', scene: 'dorm', title: '突击背书的黄金半小时',
    text: '据说睡前半小时记的东西最牢。你手上有{科目}的十二个必背定义。',
    choices: [
      { label: '全部背完再睡', tag: '卷', study: true, fx: { k: 15, s: -12, m: -4 }, result: '十二个背完躺下，脑子里自动循环。第二天早上居然真的都记得。' },
      { label: '只背最可能考的五个', tag: '稳', study: true, fx: { k: 11, s: -4, m: 5 }, result: '五个背得很牢。第二天试卷上出现了三个。精准打击。' },
      { label: '录成语音，躺着听', tag: '躺', study: true, fx: { k: 7, s: 8, m: 4 }, result: '听着自己的声音睡着了。效果一般，但你睡得很好。' }
    ]
  },
  {
    id: 'n10', slot: 'night', scene: 'dorm', title: '室友的呼噜声',
    text: '凌晨一点，室友开始打呼，节奏稳定得像节拍器。你还差{科目}的两道大题没弄懂。',
    choices: [
      { label: '去走廊，坐着看', tag: '卷', study: true, fx: { k: 12, s: -14, m: -6 }, result: '走廊灯是感应的，每两分钟要挥一次手。你还是把两道题弄懂了。' },
      { label: '戴耳塞硬扛', tag: '稳', study: true, fx: { k: 8, s: -9, m: -3 }, result: '耳塞挡掉了大半。你在呼噜的间隙里想通了其中一道。' },
      { label: '算了，睡觉', tag: '躺', fx: { s: 20, m: 6, k: -4 }, result: '你放弃了两道题，换来一觉好眠。第二天考卷上真出现了其中一道。' }
    ]
  },
  {
    id: 'n11', slot: 'night', scene: 'canteen', title: '深夜的第四罐',
    text: '功能饮料的拉环声在自习室里格外响。你已经喝了三罐，手有点抖，{科目}还剩一节。',
    choices: [
      { label: '开第四罐', tag: '险', study: true, fx: { k: 13, s: -20, m: -12 }, result: '心跳快得能数出来。那一节看完了，但你不确定明天还能不能站起来。' },
      { label: '换成热水，慢慢看', tag: '稳', study: true, fx: { k: 9, s: -4, m: 6 }, result: '热水下去胃舒服了。速度慢一点，但记住的比例高得多。' },
      { label: '不看了，去睡', tag: '躺', fx: { s: 24, m: 10, k: -3 }, result: '你选择相信身体。躺下时那一节的内容在梦里还在飘。' }
    ]
  },
  {
    id: 'n12', slot: 'night', scene: 'online', title: '明天的作战计划',
    text: '睡前你打开备忘录。明天是{科目}考试前的最后一天，可用时间十四小时。',
    choices: [
      { label: '排满十四小时，精确到分钟', tag: '卷', study: true, fx: { k: 10, m: -8, s: -8 }, result: '计划表很漂亮。你知道自己大概只能完成六成，但写的时候很安心。' },
      { label: '只列三件必须做的事', tag: '稳', study: true, fx: { k: 9, m: 10, s: 4 }, result: '三件事，清晰可执行。你带着确定感睡了。' },
      { label: '不列了，明天见机行事', tag: '躺', fx: { m: 6, s: 12, k: -2 }, result: '你决定相信临场判断。这个决定让你少焦虑了一小时。' }
    ]
  },

  {
    id: 'f_collapse', slot: 'any', scene: 'dorm', forced: true, title: '身体先罢工了',
    text: '你在自习室趴下去的那一秒就失去了意识。醒来时口水洇湿了{科目}的第三章，两小时过去了。',
    choices: [
      { label: '接受现实，慢慢缓过来', tag: '躺', fx: { s: 34, m: -12, k: -5 }, result: '你喝了半瓶水，坐了很久。身体强制帮你按了暂停键。' },
      { label: '强行继续，不管了', tag: '险', study: true, fx: { s: 14, m: -20, k: 4 }, result: '你站起来了，但整个下午都在飘。这不是复习，这是硬撑。' }
    ]
  },
  {
    id: 'f_burnout', slot: 'any', scene: 'campus', forced: true, title: '心态先崩了',
    text: '你把{科目}的书合上，走到楼下，在台阶上坐了四十分钟。什么都没想，也什么都想不动。',
    choices: [
      { label: '给家里打个电话', tag: '友', fx: { m: 32, s: 8, k: -6, n: 4 }, result: '家里说"考不好也没事"。你在台阶上哭了一会儿，然后好多了。' },
      { label: '自己坐够，再回去', tag: '稳', fx: { m: 26, s: 12, k: -8 }, result: '四十分钟后你站起来了。没解决什么，但又能往下走了。' }
    ]
  },
  {
    id: 'f_tip', slot: 'any', scene: 'online', forced: true, title: '人脉兑现的时刻',
    text: '你之前帮过的人突然发来一份{科目}的考前押题，说"就发你一个人"。',
    choices: [
      { label: '认真过一遍押题', tag: '卷', study: true, fx: { k: 18, m: 12, s: -6 }, result: '押题命中率不详，但过一遍之后你的框架清楚了很多。' },
      { label: '转发给同样在挣扎的室友', tag: '友', fx: { k: 12, n: 16, m: 14, s: -4 }, result: '室友说了十遍谢谢。你们一起过了一遍，互相补了漏洞。' }
    ]
  }
];

FZ.EXAM = [
  {
    title: '选择题 · 最后五道',
    text: '这五道你完全没底。监考老师看了眼手表，还剩二十二分钟。',
    choices: [
      { label: '用排除法，逐个划掉', fx: { mod: 5, s: -6, m: 3 }, result: '划掉了明显错误的选项，剩下的靠推理。对了两道。' },
      { label: '全部相信第一直觉', fx: { mod: 3, s: -2, m: 6 }, result: '直觉有时候是对的。你不去想它，心态稳住了。' },
      { label: '全部选 C，省下时间', fx: { mod: -2, s: 4, m: -4 }, result: '概率学上说得通，但你知道自己在赌。' }
    ]
  },
  {
    title: '计算大题 · 十四分',
    text: '这道{科目}的大题你见过类似的，但中间一步卡住了。草稿纸只剩半页。',
    choices: [
      { label: '硬算到底，把过程写满', fx: { mod: 6, s: -12, m: -5 }, result: '你算了整整八分钟，最后一步终于通了。手心全是汗。' },
      { label: '写出能写的步骤，拿步骤分', fx: { mod: 3, s: -5, m: 5 }, result: '公式、代入、思路都写上了。就算答案不对，也能捞回一半。' },
      { label: '跳过，先做后面的', fx: { mod: 0, s: 2, m: 2 }, result: '你果断放弃，后面的题答得很顺。回头看时已经没时间了。' }
    ]
  },
  {
    title: '论述题 · 最后一道',
    text: '题目要求结合{专业}的实际谈谈理解。你脑子里有一堆碎片，但没成体系。剩六分钟。',
    choices: [
      { label: '按框架展开，写满答题区', fx: { mod: 5, s: -8, m: -3 }, result: '你把三天里搭的骨架用上了。写到最后一行时铃响。' },
      { label: '结合自己真实的课程经历写', fx: { mod: 4, s: -4, m: 8 }, result: '写得很具体，有例子。这种答案老师通常愿意给分。' },
      { label: '套用背过的通用模板', fx: { mod: 1, s: -2, m: 3 }, result: '模板能填满纸面，但你清楚它没回答题目真正问的东西。' }
    ]
  }
];

FZ.ENDINGS = [
  { id: 'lost',    seal: '失', title: '卷到失智',     color: '#FF4D4D', rarity: '常见', line: '知识装满了，人没到场。考场上你的大脑拒绝开机。' },
  { id: 'broken',  seal: '崩', title: '心态先挂',     color: '#FF3D8B', rarity: '常见', line: '挂的不是{科目}，是你自己。下次先修心态再修课。' },
  { id: 'retake',  seal: '修', title: '重修预约成功', color: '#FF4D4D', rarity: '常见', line: '教务处已经为你留好了下学期的座位，靠窗。' },
  { id: 'harvest', seal: '绩', title: '绩点收割机',   color: '#B6F03C', rarity: '稀有', line: '别人在求生，你在进货。这门课的绩点被你打包带走了。' },
  { id: 'luck',    seal: '玄', title: '玄学通关型',   color: '#FFB020', rarity: '稀有', line: '复习的和考的两模两样，但你蒙的全对。建议去买彩票。' },
  { id: 'network', seal: '王', title: '人脉之王',     color: '#35D6F5', rarity: '稀有', line: '你复习的不是{科目}，是人际关系。而且它真的有用。' },
  { id: 'grind',   seal: '肝', title: '通宵肝帝',     color: '#FFB020', rarity: '常见', line: '三天睡了七小时，换来一个及格。医学上不建议复现。' },
  { id: 'nail',    seal: '钉', title: '图书馆钉子户', color: '#B6F03C', rarity: '少见', line: '闭馆音乐是你的下班铃。管理员已经记住你的脸了。' },
  { id: 'slack',   seal: '摆', title: '摆烂幸存者',   color: '#FF3D8B', rarity: '少见', line: '没怎么复习，心态极好，分数居然过了。玄学界的优等生。' },
  { id: 'steady',  seal: '稳', title: '稳如老狗',     color: '#B6F03C', rarity: '稀有', line: '睡够了、背完了、朋友还在。期末周被你打成了一场养生局。' },
  { id: 'skim',    seal: '掠', title: '低空掠过',     color: '#FFB020', rarity: '常见', line: '六十分万岁，多一分浪费。你精确地完成了任务。' }
];

FZ.GRADES = [
  { min: 90, letter: 'A',  point: '4.0', word: '优秀' },
  { min: 80, letter: 'B',  point: '3.3', word: '良好' },
  { min: 70, letter: 'C',  point: '2.3', word: '中等' },
  { min: 60, letter: 'D',  point: '1.0', word: '及格' },
  { min: 0,  letter: 'F',  point: '0.0', word: '挂科' }
];
