// =====================================================================
//  《石头剪刀布 · 手势对决》— 手势交互游戏
//  PART A（下面）是手部识别引擎（MediaPipe Gesture Recognizer），不要修改。
//  PART A (below) is the hand engine (MediaPipe Gesture Recognizer): don't change it.
//  PART B（底部）是游戏逻辑。
//  PART B (at the bottom) is the game logic.
// =====================================================================


// ---------------------------------------------------------------------
//  PART A — 手部识别引擎（按老师反馈升级为 Gesture Recognizer，不要修改）
//  PART A — hand engine (upgraded to Gesture Recognizer per teacher feedback; don't change it)
//
//  它打开摄像头的"眼睛"（Google 的 MediaPipe 手势识别模型），
//  每一帧把看到的信息写进四个并排的列表（同一只手的索引相同）：
//    hands        — 每只手的 21 个点 {x, y, z}（画布像素坐标，已经镜像）
//    handGestures — 每只手的手势：rock(握拳) / scissors(V 手势) / paper(张开手掌) / none
//    handSides    — 每只手是哪一只手："Left" 左手 / "Right" 右手
//    handScores   — 每只手手势的置信度 0..1
//    handRawGestures — 每只手手势的原始类别名（如 Thumb_Up，用于提示玩家）
//  两只手最多都能识别到（numHands = 2）/ up to two hands (numHands = 2)
// ---------------------------------------------------------------------
const MP_VERSION = "0.10.21";
// MediaPipe 的两个下载来源：先用国内镜像 npmmirror，失败再用 jsDelivr
const MP_URLS = [
  `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`,
];
// 手势识别模型：先找项目文件夹里的 gesture_recognizer.task，没有再从 Google 下载
const MODEL_URLS = [
  "gesture_recognizer.task",
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
];

// Gesture Recognizer 内置手势类别 → 石头剪刀布（其余类别一律算"未识别"）
const GESTURE_MAP = {
  Closed_Fist: "rock",   // 握拳 → 石头
  Victory: "scissors",   // V 手势 → 剪刀
  Open_Palm: "paper",    // 张开手掌 → 布
};

// 常用的手部关键点编号（每只手一共 21 个点）。
// Hand landmark numbers (21 per hand).
// 画面是镜像的：你的左手显示在画面左边。
// The picture is mirrored: your left hand is on the left of the screen.
const HAND = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

let video;                  // 摄像头画面 / the webcam
let gestureRecognizer = null; // MediaPipe 手势识别模型 / the gesture recognizer model
let hands = [];             // 每一帧：看到的所有手（最多 2 只）。每只手 = 21 个点 {x, y, z}
                            // every frame: the hands the camera sees (max 2); each = 21 points {x, y, z}
                            // x、y 是画布像素坐标（已经镜像）/ x, y are canvas pixels (already mirrored)
let handGestures = [];      // 对应每只手的手势（rock / scissors / paper / none）
let handSides = [];         // 对应每只手："Left" 左手 / "Right" 右手
let handScores = [];        // 对应每只手的手势置信度 0..1
let handRawGestures = [];   // 对应每只手手势的原始类别名（如 Thumb_Up）
let lastVideoTime = -1;
let started = false;
let showCamera = false;
let showSkeleton = false;
let showHandTracking = false; // C 键：手势识别线（骨架连线 + 手腕上的手势标签）
let handsUpdated = false;     // 这一帧摄像头是否给出了新的识别结果（防止同一结果重复计票）

async function loadGestureRecognizer() {
  setStatus("正在加载手势识别模型… / Loading the hand model…");
  for (const base of MP_URLS) {
    let vision, fileset;
    try {
      vision = await import(`${base}/vision_bundle.mjs`);
      fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
    } catch (e) {
      continue;
    }
    for (const model of MODEL_URLS) {
      for (const delegate of ["GPU", "CPU"]) {
        try {
          gestureRecognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: model, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
          return;
        } catch (e) {
          // 失败就试下一个 / try the next one
        }
      }
    }
  }
  setStatus("⚠️ 手势模型加载失败：请把 gesture_recognizer.task 放进项目文件夹 / Gesture model failed to load: put gesture_recognizer.task in the project folder");
}

// 每一帧调用一次 / call once per frame
let cameraOk = null;
function updateHands() {
  if (!gestureRecognizer || !video) return;
  const ok = video.elt.readyState >= 2;
  if (ok !== cameraOk) {
    cameraOk = ok;
    setStatus(ok ? "手势识别已就绪 ✋ / Hand tracking is ready"
                 : "正在等待摄像头… / Waiting for the camera…");
  }
  if (!ok) return;
  if (video.elt.currentTime === lastVideoTime) return;
  lastVideoTime = video.elt.currentTime;
  handsUpdated = true;   // 只有拿到新识别结果才标记；投票和双手确认都以这个为准

  const result = gestureRecognizer.recognizeForVideo(video.elt, performance.now());
  hands = result.landmarks.map((pts) =>
    pts.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z }))
  );
  handGestures = result.gestures.map((g) =>
    g.length ? (GESTURE_MAP[g[0].categoryName] || "none") : "none"
  );
  // 兼容不同版本 MediaPipe 的字段名（老师的示例写法）
  const sides = result.handedness || result.handednesses || [];
  handSides = sides.map((h) => (h.length ? h[0].categoryName : "Unknown"));
  handScores = result.gestures.map((g) => (g.length ? g[0].score : 0));
  handRawGestures = result.gestures.map((g) => (g.length ? g[0].categoryName : ""));
}

// 这个点看得清楚吗？/ is this point clearly visible?
function isVisible(p) {
  return p && p.x > -50 && p.x < width + 50 && p.y > -50 && p.y < height + 50;
}

// 画出细细的手部骨架（学习和调试用，按 K 显示/隐藏）
// thin hand skeleton for learning and debugging (key K)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // 拇指 / thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // 食指 / index
  [5, 9], [9, 10], [10, 11], [11, 12],      // 中指 / middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // 无名指 / ring
  [13, 17], [17, 18], [18, 19], [19, 20],   // 小指 / pinky
  [0, 17],                                  // 手掌 / palm
];
function drawSkeleton() {
  push();
  for (const hand of hands) {
    stroke(255, 255, 0, 200);
    strokeWeight(2);
    for (const [a, b] of HAND_CONNECTIONS) {
      if (isVisible(hand[a]) && isVisible(hand[b])) line(hand[a].x, hand[a].y, hand[b].x, hand[b].y);
    }
    noStroke();
    fill(255, 80, 80);
    for (const i of Object.values(HAND)) if (isVisible(hand[i])) circle(hand[i].x, hand[i].y, 8);
  }
  pop();
}

function drawCamera() {
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(255, 90);
  image(video, 0, 0, width, height);
  pop();
}

function setStatus(msg) {
  select("#status").html(msg);
}


// ---------------------------------------------------------------------
//  PART B — 游戏逻辑（从这里开始，由 Qwen 逐步写入）
//  PART B — game logic (starts here; Qwen writes it step by step)
//
//  三个游戏都会写在这个 sketch.js 里（同一个项目，同一个文件）：
//  封面选择 → 进入对应游戏 → 可以返回封面，游戏之间互不干扰。
// ---------------------------------------------------------------------

// ============ 公共基础 1：手势定义 ============
const GESTURES = ["rock", "scissors", "paper"];
const GESTURE_NAMES = { rock: "石头", scissors: "剪刀", paper: "布" };
const GESTURE_EMOJI = { rock: "✊", scissors: "✌️", paper: "🖐" };
const GESTURE_KEYS = { "1": "rock", "2": "scissors", "3": "paper" };

// 手势分类由 PART A 的 Gesture Recognizer 模型直接提供（handGestures 列表）：
// 握拳 → 石头，V 手势 → 剪刀，张开手掌 → 布，其余 → 未识别。
// 游戏逻辑只需要读取 handGestures / handSides，不需要自己算手势。

// ============ 公共基础 1.5：识别状态提示 ============
// 让玩家一眼分清三种情况：没检测到手 / 手势不清楚 / 识别成了别的动作。
const RAW_EMOJI = {
  Thumb_Up: "👍", Thumb_Down: "👎", ILoveYou: "🤟", Pointing_Up: "☝️",
  Open_Palm: "🖐", Closed_Fist: "✊", Victory: "✌️",
};

// 返回第 i 只手的识别状态文字（i 是 hands 的索引；没有手 / 置信度低 / 其他手势 / 正常）
function handStatusText(i) {
  if (i < 0 || i >= hands.length) return "未检测到手 · 请把手放进画面";
  const raw = handRawGestures[i] || "";
  const score = handScores[i] || 0;
  const g = handGestures[i];
  if (score < 0.5) return "手势不清楚 · 请做标准";
  if (g !== "none") return GESTURE_NAMES[g] + " " + Math.round(score * 100) + "%";
  return (RAW_EMOJI[raw] || "✋") + " " + raw + " · 请做石头/剪刀/布";
}

// 对应状态的颜色：正常绿 / 不清楚黄 / 其他动作橙 / 未检测到灰
function handStatusColor(i) {
  if (i < 0 || i >= hands.length) return color(150, 170, 190);
  const score = handScores[i] || 0;
  if (score < 0.5) return color(255, 200, 80);
  if (handGestures[i] !== "none") return color(140, 255, 160);
  return color(255, 160, 100);
}

// 在每只手的手腕旁显示"手势名 + 把握程度"小标签（借鉴老师的示例，跟着手走）
// 玩家低头看手，就能实时看到模型认成了什么、多有把握
function drawHandLabels() {
  push();
  textSize(15);
  textAlign(CENTER, TOP);
  for (let i = 0; i < hands.length; i++) {
    const w = hands[i] && hands[i][0];   // 手腕点（第 0 号关键点）
    if (!w || !isVisible(w)) continue;
    const y = min(w.y + 14, height - 90);
    const raw = handRawGestures[i] || "";
    const score = handScores[i] || 0;
    const g = handGestures[i];
    const name = g !== "none" ? GESTURE_NAMES[g] : ((RAW_EMOJI[raw] || "✋") + " " + raw);
    const label = name + " " + Math.round(score * 100) + "%";
    noStroke();
    fill(0, 130);
    rect(w.x - textWidth(label) / 2 - 8, y, textWidth(label) + 16, 26, 6);
    fill(handStatusColor(i));
    text(label, w.x, y + 4);
  }
  pop();
}

// ============ 公共基础 1.6：游戏视觉反馈 ============
// 成功粒子：短促、从目标下方散开，快速消散，不遮住目标手势
let burstParticles = [];
function spawnBurst(x, y) {
  for (let i = 0; i < 26; i++) {
    const a = random(TWO_PI);
    const sp = random(2, 6.5);
    burstParticles.push({ x, y, vx: cos(a) * sp, vy: sin(a) * sp - 1, life: 1 });
  }
}
function updateBursts() {
  for (const p of burstParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.93;
    p.vy *= 0.93;
    p.life -= 0.05;
  }
  burstParticles = burstParticles.filter((p) => p.life > 0);
}
function drawBursts() {
  noStroke();
  for (const p of burstParticles) {
    fill(140, 255, 160, p.life * 255);
    circle(p.x, p.y, 10 * p.life + 3);
  }
}

// 底部识别状态条：半透明底 + 彩色文字（识别正常 / 未检测到手 / 手势不清楚 / 其他动作）
// cx 不传时居中；双手阶段传左右手各自的 x，两条分开显示
function drawStatusBar(txt, col, cx) {
  if (cx === undefined) cx = width / 2;
  push();
  textAlign(CENTER, CENTER);
  textSize(17);
  const w = textWidth(txt) + 40;
  noStroke();
  fill(10, 16, 26, 170);
  rect(cx - w / 2, height - 76, w, 40, 20);
  fill(col);
  text(txt, cx, height - 56);
  pop();
}

// 目标手势底座：深色圆盘 + 高亮圆环 + 手势 emoji 和名字（side 传 "左手"/"右手"/null）
function drawGestureRing(x, y, r, g, side) {
  push();
  textAlign(CENTER, CENTER);
  noStroke();
  fill(30, 40, 56, 235);
  circle(x, y, r * 2);
  stroke(63, 168, 232);
  strokeWeight(4);
  noFill();
  circle(x, y, r * 2);
  noStroke();
  fill(255);
  textSize(r * 1.0);
  text(GESTURE_EMOJI[g], x, y - r * 0.06);
  fill(150, 175, 205);
  textSize(r * 0.2);
  text(GESTURE_NAMES[g], x, y + r * 0.6);
  if (side) {
    fill(63, 168, 232);
    rect(x - 50, y - r - 26, 100, 28, 14);
    fill(16, 22, 32);
    textSize(15);
    text(side, x, y - r - 12);
  }
  pop();
}

// 画布内"重新挑战"按钮（游戏结束页可点击；也可按 R）
let btnRetry = { x: 0, y: 0, w: 240, h: 58 };

// ============ 公共基础 1.8：屏幕边缘氛围光（任务反馈） ============
// 绿色：做对了 · 橙色：未识别到（没检测到手 / 手势不标准）· 红色：识别到了但做错
const GLOW_GREEN = { r: 80, g: 255, b: 140, a: 0.6 };
const GLOW_ORANGE = { r: 255, g: 170, b: 80, a: 0.45 };
const GLOW_RED = { r: 255, g: 90, b: 90, a: 0.52 };

// 当前应该显示什么颜色的氛围光（null = 不发光）
function currentGlow() {
  if (gameState !== "playing") return null;
  if (currentGame === 1) {
    const lv = G1_LEVELS[g1Level];
    if (lv.hands === 1) {
      if (playerGesture === "none") return GLOW_ORANGE;        // 没检测到手 / 手势不标准
      if (playerGesture === g1Target.left) return GLOW_GREEN;  // 做对
      return GLOW_RED;                                         // 识别到了但做错
    }
    // 双手：屏幕左侧目标由左手完成、右侧由右手完成
    const idxL = handSides.indexOf("Left");
    const idxR = handSides.indexOf("Right");
    const a = idxL >= 0 ? handGestures[idxL] : "none";
    const b = idxR >= 0 ? handGestures[idxR] : "none";
    if (a === "none" || b === "none") return GLOW_ORANGE;     // 有手没检测全
    if (a === g1Target.left && b === g1Target.right) return GLOW_GREEN;
    return GLOW_RED;
  }
  // 游戏二"反着来"：目标是不能和屏幕相同的手势
  if (playerGesture === "none") return GLOW_ORANGE;
  if (playerGesture === roundTarget) return GLOW_RED;          // 会触发炸弹
  return GLOW_GREEN;                                           // 合法回应
}

// 画屏幕边缘氛围光：中心透明，越靠边缘越亮（像灯光从四周照进来）
function drawGlow() {
  const g = currentGlow();
  if (!g) return;
  const ctx = drawingContext;
  const cx = width / 2, cy = height / 2;
  const rIn = min(width, height) * 0.4;
  const rOut = Math.sqrt(cx * cx + cy * cy) + 60;
  const grad = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.62, "rgba(0,0,0,0)");
  grad.addColorStop(0.85, "rgba(" + g.r + "," + g.g + "," + g.b + "," + (g.a * 0.45) + ")");
  grad.addColorStop(1, "rgba(" + g.r + "," + g.g + "," + g.b + "," + g.a + ")");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ============ 公共基础 2：5 帧投票 + 变化沿触发 ============
// 每帧把手势写进最近 5 帧的窗口，窗口内出现最多的手势才算数（至少 3 票）。
// 这样轻微抖动不会打断确认，换手势后最多 3 帧就能跟上。
let frameGesture = "none";         // 当前稳定识别出的手势
let lastGesture = "none";          // 上一次"已确认并已发出"的手势
let gestureHistory = [];           // 最近 5 帧的手势窗口
let lastGestureEvent = { g: "none", t: 0 }; // 最近一次手势变化事件
let lastConsumedT = 0;             // 游戏已经处理过的事件时间
// 游戏一读取的"当前玩家手势"：手部投票确认（hand）或键盘模拟（key）
let playerGesture = "none";
let playerGestureSource = "hand";
let playerGestureT = 0;

function updateGesture() {
  // 只在摄像头给出新识别结果时计票：同一帧结果不会在画面更新前反复投票
  if (!handsUpdated) return;
  // 置信度低于 0.5 的手势不算数，避免把低把握的误判当真（老师的示例用 0.6，这里放宽到 0.5）
  const g = hands.length && (handScores[0] || 0) >= 0.5 ? handGestures[0] : "none";
  gestureHistory.push(g);
  if (gestureHistory.length > 5) gestureHistory.shift();
  const counts = {};
  for (const x of gestureHistory) if (x !== "none") counts[x] = (counts[x] || 0) + 1;
  let best = "none", bestN = 0;
  for (const k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  frameGesture = bestN >= 3 ? best : "none";
  // 没有稳定手势（手离开画面或手势不清楚）：清空手部来源的玩家手势，
  // 并把 lastGesture 一起重置，这样松手后重新做同一个手势也能再次触发"变化事件"
  if (frameGesture === "none") {
    lastGesture = "none";
    if (playerGestureSource === "hand") playerGesture = "none";
    if (currentGame === 1) g1NeedRelease = false;   // 松手后允许重新开始匹配
  } else if (frameGesture !== lastGesture) {
    lastGesture = frameGesture;
    onGestureChanged(frameGesture);
    playerGesture = frameGesture;
    playerGestureSource = "hand";
    playerGestureT = millis();
  }
}

function onGestureChanged(g) {
  if (g !== "none") {
    lastGestureEvent = { g, t: millis() };
    // 游戏一：做出新动作（换手势或键盘按下）后，允许重新开始匹配
    if (currentGame === 1) g1NeedRelease = false;
  }
}

// ============ 公共基础 3：游戏外壳 ============
let gameState = "menu";    // menu（选择游戏）/ playing / gameover
let currentGame = 0;       // 0 = 选择界面, 1 = 游戏一·照做, 2 = 游戏二·反着来

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  select("#start").mouseClicked(startExperience);
  select("#btn1").mouseClicked(startGame1);
  select("#btn2").mouseClicked(startGame2);
  // 直接双击打开时（file: 协议），浏览器会禁用摄像头，给出明确提示
  if (window.location.protocol === "file:") {
    const warn = select("#filewarn");
    if (warn) warn.style("display", "block");
  }
  // 页面打开时就预加载手势模型，点"开始"后不用等，立刻进游戏
  loadGestureRecognizer();
}

function startExperience() {
  if (started) {
    // 摄像头和模型已在跑，直接显示"选择游戏"界面
    showMenu();
    return;
  }
  setStatus("正在打开摄像头，请在浏览器弹窗中点击“允许”…");
  // 声音初始化失败不影响摄像头（例如无音频设备的环境）
  try { userStartAudio(); } catch (e) {}
  try {
    video = createCapture(VIDEO);
    video.size(640, 480);
    video.hide();
  } catch (e) {
    console.error("createCapture failed:", e);
    setStatus("摄像头打开失败：请用 Live Server 打开本页（直接双击文件时浏览器会禁用摄像头）");
    return;
  }
  select("#intro").hide();
  started = true;
  // 模型在页面打开时已预加载（setup 里调用），就绪后自动开始识别；
  // 先进"选择游戏"界面，选好游戏再开始。
  showMenu();
}

// 显示 / 隐藏"选择游戏"界面
function showMenu() {
  gameState = "menu";
  currentGame = 0;
  select("#menu").style("display", "flex");
}

function hideMenu() {
  select("#menu").style("display", "none");
}

// ============ 游戏二 "反着来"（反应挑战）============
// 规则：屏幕显示一个手势，你的回应必须"与屏幕不同"且"不重复上一轮自己的手势"。
// 相同 → 炸弹，游戏结束；重复 → 提示不加分，倒计时继续；合法 → 得分 + 连击。
let roundTarget = "rock";        // 屏幕要求的手势
let roundReadyT = 0;             // 准备阶段结束时间
let roundCountStart = 0;         // 倒计时开始时间
let roundTimeTotal = 3;          // 本轮总时长（秒）
let roundTimeLeft = 3;
let lastPlayerGesture = "none";  // 上一轮玩家有效使用的手势
let score = 0;
let combo = 0;
let level = 1;
let feedback = "";
let feedbackT = 0;
let gameOverReason = "";

function levelTime() {
  return level === 1 ? 4 : level === 2 ? 3 : 2.5;   // L1 4 秒 → L2 3 秒 → L3 2.5 秒
}

function startGame2() {
  currentGame = 2;
  gameState = "playing";
  hideMenu();
  score = 0;
  combo = 0;
  level = 1;
  lastPlayerGesture = "none";
  startRound2();
}

function startRound2() {
  roundTarget = random(GESTURES);
  roundReadyT = millis() + 1500;   // 1.5 秒准备：先看清目标
  roundCountStart = roundReadyT;
  roundTimeTotal = levelTime();
  roundTimeLeft = roundTimeTotal;
  feedback = "";
  feedbackT = 0;
  lastConsumedT = millis();        // 防止上一轮的残留事件被当成新一轮回应
}

function respond2(g) {
  if (g === roundTarget) {
    gameOver("炸弹！你做出了和屏幕相同的手势");
    return;
  }
  if (g === lastPlayerGesture) {
    feedback = "不能重复上一轮的手势！本轮不加分";
    feedbackT = millis();
    return;
  }
  combo++;
  const gain = 10 + (combo - 1) * 2;
  score += gain;
  lastPlayerGesture = g;
  feedback = "正确 +" + gain + " 分 · 连击 x" + combo;
  feedbackT = millis();
  if (score >= 25) level = 3;
  else if (score >= 10) level = 2;
  startRound2();
}

function gameOver(reason) {
  gameState = "gameover";
  gameOverReason = reason;
}

function updateGame2() {
  const now = millis();
  // 消费最新的手势事件（只处理本轮开始之后的新事件）
  const ev = lastGestureEvent;
  if (ev.t > lastConsumedT && ev.g !== "none") {
    lastConsumedT = ev.t;
    respond2(ev.g);
  }
  // 倒计时
  if (now >= roundCountStart) {
    roundTimeLeft = roundTimeTotal - (now - roundCountStart) / 1000;
    if (roundTimeLeft <= 0) gameOver("超时！没有做出有效回应");
  }
}

function drawGame2() {
  push();
  // 顶部 HUD：左侧信息面板（得分 / 连击 / 档位）
  noStroke();
  fill(24, 32, 46, 205);
  rect(14, 12, 215, 92, 14);
  textAlign(LEFT, TOP);
  fill(255); textSize(18);
  text("得分 " + score, 30, 22);
  fill(255, 200, 80); textSize(16);
  text("连击 x" + combo, 30, 50);
  fill(255); textSize(16);
  text("档位 L" + level, 30, 76);
  // 顶部倒计时条 + 数字
  const frac = constrain(roundTimeLeft / roundTimeTotal, 0, 1);
  noStroke();
  fill(50, 70, 100);
  rect(width / 2 - 150, 16, 300, 8);
  fill(frac > 0.3 ? color(63, 168, 232) : color(220, 80, 80));
  rect(width / 2 - 150, 16, 300 * frac, 8);
  textAlign(CENTER, TOP);
  fill(255); textSize(28);
  text(max(ceil(roundTimeLeft), 0), width / 2, 30);
  // 中央目标手势
  textSize(90);
  text(GESTURE_EMOJI[roundTarget], width / 2, height / 2 - 120);
  fill(255); textSize(24);
  text("做出与「" + GESTURE_NAMES[roundTarget] + "」不同的手势", width / 2, height / 2 - 8);
  // 准备提示
  if (millis() < roundReadyT) {
    fill(255, 200, 80); textSize(26);
    text("准备好！", width / 2, height / 2 + 40);
  }
  // 玩家识别结果（底部状态条，颜色按状态分层）
  drawStatusBar("识别： " + handStatusText(0), handStatusColor(0));
  // 上一轮记录
  if (lastPlayerGesture !== "none") {
    fill(120, 140, 170); textSize(14);
    text("上一轮你出了：" + GESTURE_NAMES[lastPlayerGesture], width / 2, height - 96);
  }
  // 反馈
  if (millis() - feedbackT < 1500) {
    fill(255, 200, 80); textSize(20);
    text(feedback, width / 2, height / 2 + 84);
  }
  pop();
}

function drawGameOver2() {
  push();
  fill(10, 14, 20, 210);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(255, 110, 110); textSize(44);
  text("游戏结束", width / 2, height / 2 - 130);
  fill(230, 240, 255); textSize(20);
  text(gameOverReason, width / 2, height / 2 - 70);
  text("得分 " + score + " · 最高连击 x" + combo, width / 2, height / 2 - 30);
  // 重新挑战按钮（可点击，也可按 R）
  btnRetry = { x: width / 2, y: height / 2 + 24, w: 240, h: 58 };
  noStroke();
  fill(63, 168, 232);
  rect(btnRetry.x - btnRetry.w / 2, btnRetry.y - btnRetry.h / 2, btnRetry.w, btnRetry.h, 29);
  fill(16, 22, 32); textSize(20);
  text("重新挑战", btnRetry.x, btnRetry.y);
  fill(150, 175, 205); textSize(15);
  text("按 R 重玩 · 按 M 返回选择游戏", width / 2, btnRetry.y + btnRetry.h / 2 + 26);
  pop();
}

// ============ 游戏一 "照做"（模仿挑战）============
// 规则：屏幕显示目标手势，你做出一模一样的手势（单手：1 个；双手：2 个同时）。
// 时间先慢后快，每关 6 个手势，做对 5 个过关（给"未识别到"留容错），总分累计。
const G1_LEVELS = [
  { hands: 1, time: 5, need: 5, label: "单手" },
  { hands: 1, time: 4, need: 5, label: "单手" },
  { hands: 2, time: 5, need: 5, label: "双手" },
  { hands: 2, time: 4, need: 5, label: "双手" },
];
const G1_TOTAL = 6;                  // 每关手势数

let g1Level = 0;                     // 当前关卡 0..3
let g1Round = 0;                     // 本关第几个目标 0..5
let g1Target = { left: "rock", right: null };
let g1Targets = [];                  // 本关目标序列
let g1Correct = 0;                   // 本关做对数
let g1Score = 0;                     // 累计总分
let g1TimeTotal = 5;
let g1TimeLeft = 5;
let g1State = "intro";               // intro / doing / result / win / lose
let g1StateT = 0;
let g1Msg = "";
let g1MsgT = 0;
let g1MatchFrames = 0;               // 双手匹配连续帧数
let g1CoolT = 0;                     // 结算冷却结束时间
let g1NeedRelease = false;           // 结算后需"重新做一次"才能再匹配（防手一直举着自动过关）

function startGame1() {
  currentGame = 1;
  gameState = "playing";
  hideMenu();
  g1Score = 0;
  g1Level = 0;
  startG1Level();
}

function startG1Level() {
  const lv = G1_LEVELS[g1Level];
  g1Round = 0;
  g1Correct = 0;
  g1Targets = [];
  for (let i = 0; i < G1_TOTAL; i++) {
    g1Targets.push({
      left: random(GESTURES),
      right: lv.hands === 2 ? random(GESTURES) : null,
    });
  }
  g1State = "intro";
  g1StateT = millis();
}

function nextG1Target() {
  if (g1Round >= G1_TOTAL) {
    const lv = G1_LEVELS[g1Level];
    if (g1Correct >= lv.need) {
      g1Score += 20;                 // 过关奖励
      g1Msg = "过关！ +20 奖励";
      g1State = "result";
      g1StateT = millis();
    } else {
      g1State = "lose";
    }
    return;
  }
  g1Target = g1Targets[g1Round];
  g1TimeTotal = G1_LEVELS[g1Level].time;
  g1TimeLeft = g1TimeTotal;
  g1MatchFrames = 0;
  g1CoolT = millis() + 600;          // 结算后 0.6 秒冷却，防止同一手势连续结算
  g1State = "doing";
  g1StateT = millis();
}

function checkG1Match() {
  const lv = G1_LEVELS[g1Level];
  if (lv.hands === 1) {
    // 单手：结算后必须"重新做一次"（松手或换手势）才能再次匹配，防止手一直举着自动过关
    return !g1NeedRelease && playerGesture === g1Target.left;
  }
  // 双手：屏幕左侧目标必须由玩家的左手完成、右侧由右手完成（严格对应），
  // 只按摄像头新帧计数（连续 3 个新画面才算确认），且两只手都要有足够把握（置信度 ≥ 0.5）
  const idxL = handSides.indexOf("Left");
  const idxR = handSides.indexOf("Right");
  if (idxL < 0 || idxR < 0) { g1MatchFrames = 0; g1NeedRelease = false; return false; }
  const a = handGestures[idxL];
  const b = handGestures[idxR];
  if (a === "none" || b === "none") { g1MatchFrames = 0; g1NeedRelease = false; return false; }
  if (!handsUpdated) return g1MatchFrames >= 3 && !g1NeedRelease;   // 没有新画面：维持已确认状态
  const ok = a === g1Target.left && b === g1Target.right &&
             (handScores[idxL] || 0) >= 0.5 && (handScores[idxR] || 0) >= 0.5 &&
             !g1NeedRelease;
  if (ok) g1MatchFrames++;
  else g1MatchFrames = 0;
  return g1MatchFrames >= 3;
}

function updateG1() {
  const now = millis();
  if (g1State === "intro") {
    if (now - g1StateT > 2000) nextG1Target();
  } else if (g1State === "doing") {
    g1TimeLeft = g1TimeTotal - (now - g1StateT) / 1000;
    if (g1TimeLeft <= 0) {
      g1Msg = "时间到 · 未识别到"; g1MsgT = now;
      g1Round++;
      nextG1Target();
      return;
    }
    if (now >= g1CoolT && checkG1Match()) {
      g1Correct++;
      g1Score += 10;
      g1Msg = "正确 +10"; g1MsgT = now;
      g1NeedRelease = true;   // 结算后必须"重新做一次"才能再匹配（防手一直举着自动连过）
      // 成功粒子：从目标下方散开（短促，不遮住手势）
      if (G1_LEVELS[g1Level].hands === 2) {
        spawnBurst(width / 2 - 170, height / 2 - 30);
        spawnBurst(width / 2 + 170, height / 2 - 30);
      } else {
        spawnBurst(width / 2, height / 2 - 20);
      }
      g1Round++;
      nextG1Target();
    }
  } else if (g1State === "result") {
    if (now - g1StateT > 2200) {
      if (g1Level >= G1_LEVELS.length - 1) {
        g1State = "win";
      } else {
        g1Level++;
        startG1Level();
      }
    }
  }
}

function drawG1Target() {
  const lv = G1_LEVELS[g1Level];
  const cy = height / 2 - 70;
  const r = min(110, height * 0.17);
  if (lv.hands === 1) {
    // 单手：屏幕中央一个目标（深色圆盘 + 高亮圆环 + 手势 emoji）
    drawGestureRing(width / 2, cy, r, g1Target.left, null);
    fill(255); textSize(22);
    text("做出相同手势", width / 2, cy + r + 36);
  } else {
    // 双手：左右并排两个目标，明确标出左手 / 右手
    drawGestureRing(width / 2 - 170, cy, r, g1Target.left, "左手");
    drawGestureRing(width / 2 + 170, cy, r, g1Target.right, "右手");
    fill(255); textSize(22);
    text("两只手同时做出这两个手势", width / 2, cy + r + 36);
  }
}

function drawGame1() {
  push();
  const lv = G1_LEVELS[g1Level];
  textAlign(CENTER, TOP);

  if (g1State === "intro") {
    // 关卡开始画面：大字标题 + 规则提示
    fill(255); textSize(42);
    text("第 " + (g1Level + 1) + " 关", width / 2, height / 2 - 150);
    fill(150, 175, 205); textSize(20);
    text(lv.label + "模式 · 共 " + G1_TOTAL + " 个手势 · 做对 " + lv.need + " 个过关", width / 2, height / 2 - 96);
    fill(255, 200, 80); textSize(18);
    text("屏幕显示手势 → 你做出相同的手势", width / 2, height / 2 - 48);
    fill(255); textSize(20);
    text("总分 " + g1Score, width / 2, height / 2 + 4);
    return;
  }

  // 顶部 HUD：左侧信息面板（关卡 / 做对 / 总分）
  noStroke();
  fill(24, 32, 46, 205);
  rect(14, 12, 215, 92, 14);
  textAlign(LEFT, TOP);
  fill(255); textSize(18);
  text("第 " + (g1Level + 1) + " 关 · " + lv.label, 30, 22);
  fill(140, 255, 160); textSize(16);
  text("做对 " + g1Correct + " / " + G1_TOTAL, 30, 50);
  fill(255); textSize(16);
  text("总分 " + g1Score, 30, 76);

  // 中央倒计时条 + 数字
  const frac = constrain(g1TimeLeft / g1TimeTotal, 0, 1);
  noStroke();
  fill(50, 70, 100);
  rect(width / 2 - 150, 16, 300, 8);
  fill(frac > 0.3 ? color(63, 168, 232) : color(220, 80, 80));
  rect(width / 2 - 150, 16, 300 * frac, 8);
  textAlign(CENTER, TOP);
  fill(255); textSize(28);
  text(max(ceil(g1TimeLeft), 0), width / 2, 30);

  // 目标手势（圆环底座 + 左手/右手徽标）
  drawG1Target();

  // 底部识别状态条：单手一条居中 / 双手左右各一条（颜色按状态分层）
  if (lv.hands === 1) {
    drawStatusBar("识别： " + handStatusText(0), handStatusColor(0));
  } else {
    const idxL = handSides.indexOf("Left");
    const idxR = handSides.indexOf("Right");
    drawStatusBar("左： " + handStatusText(idxL), handStatusColor(idxL), width / 2 - 170);
    drawStatusBar("右： " + handStatusText(idxR), handStatusColor(idxR), width / 2 + 170);
  }

  // 成功/提示反馈（短暂显示，不持续闪烁）
  if (millis() - g1MsgT < 1300) {
    fill(140, 255, 160); textSize(22);
    text(g1Msg, width / 2, height / 2 + 104);
  }
  pop();
}

function drawGameOver1() {
  push();
  fill(10, 14, 20, 210);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  if (g1State === "win") {
    fill(140, 255, 160); textSize(44);
    text("通关！全部完成", width / 2, height / 2 - 140);
    fill(230, 240, 255); textSize(22);
    text("总分 " + g1Score, width / 2, height / 2 - 80);
  } else {
    fill(255, 110, 110); textSize(44);
    text("本关失败", width / 2, height / 2 - 140);
    fill(230, 240, 255); textSize(20);
    text("第 " + (g1Level + 1) + " 关做对 " + g1Correct + "/" + G1_TOTAL + " 个（需要 " + G1_LEVELS[g1Level].need + " 个）", width / 2, height / 2 - 80);
    text("总分 " + g1Score, width / 2, height / 2 - 46);
  }
  // 重新挑战按钮（可点击，也可按 R）
  btnRetry = { x: width / 2, y: height / 2 + 14, w: 240, h: 58 };
  noStroke();
  fill(63, 168, 232);
  rect(btnRetry.x - btnRetry.w / 2, btnRetry.y - btnRetry.h / 2, btnRetry.w, btnRetry.h, 29);
  fill(16, 22, 32); textSize(20);
  text("重新挑战", btnRetry.x, btnRetry.y);
  fill(150, 175, 205); textSize(15);
  text("按 R 重玩 · 按 M 返回选择游戏", width / 2, btnRetry.y + btnRetry.h / 2 + 26);
  pop();
}

function draw() {
  background(20, 26, 34);
  if (!started) return;
  handsUpdated = false;   // 每帧重置：等 updateHands 拿到新画面才置 true
  updateHands();
  if (showCamera) drawCamera();
  if (showHandTracking) {        // C 键：手势识别线（骨架连线 + 手腕标签，绑定在手上）
    if (showSkeleton) drawSkeleton();
    drawHandLabels();
  }
  updateGesture();
  if (gameState === "menu") {
    // 选择界面：顶部实时显示识别状态，方便玩家先确认手势能被识别
    push();
    textAlign(CENTER, TOP);
    fill(handStatusColor(0)); textSize(16);
    text("识别： " + handStatusText(0), width / 2, 16);
    pop();
    return;   // 选择界面由 DOM 显示
  }
  if (gameState === "playing") {
    if (currentGame === 1) {
      updateG1();
      drawGame1();
    } else if (currentGame === 2) {
      updateGame2();
      drawGame2();
    }
  } else if (gameState === "gameover") {
    if (currentGame === 1) drawGameOver1();
    else if (currentGame === 2) drawGameOver2();
  }
  // 成功粒子画在最上层（短促、自动消散）
  updateBursts();
  drawBursts();
  // 屏幕边缘氛围光（绿：做对 · 橙：未识别到 · 红：做错）
  drawGlow();
}

function keyPressed() {
  // C：手势识别线（骨架连线 + 手腕上的手势标签，绑定在手上）
  if (key === "c" || key === "C") showHandTracking = !showHandTracking;
  // V：摄像头画面（和老师示例的键位一致）
  if (key === "v" || key === "V") showCamera = !showCamera;
  // K：骨架连线（在手势识别线打开时有效）
  if (key === "k" || key === "K") showSkeleton = !showSkeleton;
  // 选择界面：按 1 / 2 选游戏
  if (gameState === "menu") {
    if (key === "1") startGame1();
    if (key === "2") startGame2();
    return;
  }
  // 游戏中按 M 随时返回选择界面
  if (gameState === "playing" && (key === "m" || key === "M")) {
    showMenu();
    return;
  }
  // 键盘兜底：1 / 2 / 3 模拟石头 / 剪刀 / 布
  if (GESTURE_KEYS[key]) {
    onGestureChanged(GESTURE_KEYS[key]);
    playerGesture = GESTURE_KEYS[key];
    playerGestureSource = "key";
    playerGestureT = millis();
  }
  if (gameState === "gameover") {
    if (key === "r" || key === "R") {
      if (currentGame === 1) {
        if (g1State === "win") startGame1();
        else startG1Level();
      } else if (currentGame === 2) {
        startGame2();
      }
    }
    if (key === "m" || key === "M") showMenu();
  }
}

// 游戏结束页：点击画布内"重新挑战"按钮 = 按 R
function mousePressed() {
  if (gameState !== "gameover") return;
  const bx = btnRetry.x, by = btnRetry.y, bw = btnRetry.w, bh = btnRetry.h;
  if (mouseX > bx - bw / 2 && mouseX < bx + bw / 2 && mouseY > by - bh / 2 && mouseY < by + bh / 2) {
    if (currentGame === 1) {
      if (g1State === "win") startGame1();
      else startG1Level();
    } else if (currentGame === 2) {
      startGame2();
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
