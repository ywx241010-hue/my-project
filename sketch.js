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
let lastVideoTime = -1;      // 手势识别专用的视频帧时间（PART A 使用，不要动）
let lastFaceVideoTime = -1;  // 人脸追踪专用的视频帧时间（与 lastVideoTime 独立，避免被手势抢占）
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
  if (g !== "none") return "识别为" + GESTURE_NAMES[g] + " " + Math.round(score * 100) + "%";
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
  if (currentGame === 2) {
    // 游戏二"反着来"：目标是不能和屏幕相同的手势
    if (playerGesture === "none") return GLOW_ORANGE;
    if (playerGesture === roundTarget) return GLOW_RED;          // 会触发炸弹
    return GLOW_GREEN;                                           // 合法回应
  }
  if (currentGame === 3) {
    // 游戏三"危险线挑战"：手势 == 当前目标 → 绿；错误手势 → 红；未检测到手 → 橙
    if (playerGesture === "none") return GLOW_ORANGE;
    const cur = typeof g3CurrentTarget === "function" ? g3CurrentTarget() : null;
    if (cur && playerGesture === cur.type) return GLOW_GREEN;
    return GLOW_RED;
  }
  return null;
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
  select("#btn3").mouseClicked(startGame3);
  // 直接双击打开时（file: 协议），浏览器会禁用摄像头，给出明确提示
  if (window.location.protocol === "file:") {
    const warn = select("#filewarn");
    if (warn) warn.style("display", "block");
  }
  // 页面打开时就预加载手势模型和面部模型，点"开始"后不用等，立刻进游戏
  loadGestureRecognizer();
  loadFaceLandmarker();
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
let g2CountStarted = false;          // 本轮是否已进入倒计时（用于准备结束时接受"保持中的手势"）

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
  lastConsumedT = roundReadyT;     // 准备结束前的手势事件全部作废：玩家必须在"准备好！"之后重新做动作才算回应
  g2CountStarted = false;          // 进入倒计时后第一帧接受"保持中的手势"
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
  // 倒计时
  if (now >= roundCountStart) {
    roundTimeLeft = roundTimeTotal - (now - roundCountStart) / 1000;
    if (roundTimeLeft <= 0) gameOver("超时！没有做出有效回应");
  }
  // 进入倒计时的第一帧：如果玩家正保持一个有效手势，把它算作一次回应
  // （准备期做的手势不提前结算，但准备一结束、手还举着，就算玩家已经开始回应）
  if (!g2CountStarted && now >= roundCountStart) {
    g2CountStarted = true;
    if (playerGesture !== "none") respond2(playerGesture);
  }
  // 消费最新的手势事件（只处理本轮"准备结束后"发生的新动作）
  const ev = lastGestureEvent;
  if (now >= roundReadyT && ev.t > lastConsumedT && ev.g !== "none") {
    lastConsumedT = ev.t;
    respond2(ev.g);
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
  // 匹配成功时短暂显示"匹配成功"，1.3 秒后恢复实时识别状态
  const justSuccess = millis() - g1MsgT < 1300 && g1Msg.indexOf("正确") === 0;
  if (lv.hands === 1) {
    if (justSuccess) {
      drawStatusBar("匹配成功 " + g1Msg, color(140, 255, 160));
    } else {
      drawStatusBar("识别： " + handStatusText(0), handStatusColor(0));
    }
  } else {
    if (justSuccess) {
      drawStatusBar("左：匹配成功", color(140, 255, 160), width / 2 - 170);
      drawStatusBar("右：匹配成功", color(140, 255, 160), width / 2 + 170);
    } else {
      const idxL = handSides.indexOf("Left");
      const idxR = handSides.indexOf("Right");
      drawStatusBar("左： " + handStatusText(idxL), handStatusColor(idxL), width / 2 - 170);
      drawStatusBar("右： " + handStatusText(idxR), handStatusColor(idxR), width / 2 + 170);
    }
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
  updateFace();           // 面部追踪（游戏三飞机）：只在新的视频帧检测并限频
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
    } else if (currentGame === 3) {
      updateG3();
      drawGame3();
    }
  } else if (gameState === "gameover") {
    if (currentGame === 1) drawGameOver1();
    else if (currentGame === 2) drawGameOver2();
    else if (currentGame === 3) drawGameOver3();
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
  // 选择界面：按 1 / 2 / 3 选游戏
  if (gameState === "menu") {
    if (key === "1") startGame1();
    if (key === "2") startGame2();
    if (key === "3") startGame3();
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
      } else if (currentGame === 3) {
        startGame3();
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
    } else if (currentGame === 3) {
      startGame3();
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// =====================================================================
//  游戏三 "危险线挑战"（新增，2026-10-18）
//  规则：手势目标与炸弹从上方掉落；用手势消除"当前最危险（位置最低）"的手势目标；
//        用鼻尖左右移动飞机躲开炸弹；任意手势目标越过危险线 → 失败；炸弹撞飞机 → 失败。
//  技术：手势识别复用 PART A（Gesture Recognizer）；飞机由 Face Landmarker 鼻尖控制。
//  注意：面部模型独立加载（face_landmarker.task），不能复用手部模型；
//        手势和人脸共用同一个摄像头画面，只在新的视频帧到来时检测并限频。
// =====================================================================
const G3_CFG = {
  countdown: 3,            // 开局倒计时（秒）
  maxTargets: 2,           // 同一时间最多未消除的手势目标
  matchConfidence: 0.5,    // 手势消除置信度阈值
  matchFrames: 3,          // 连续几个新摄像头画面确认
  spawnInterval: 2.4,      // 基础生成间隔（秒），随难度缩短
  spawnIntervalMin: 1.0,   // 生成间隔下限
  levelUpScore: 40,        // 每 40 分提升 1 级难度
  levelMax: 5,             // 难度上限
  fallSpeed: 95,           // 基础下落速度（像素/秒）
  fallSpeedPerLevel: 26,   // 每级增加
  fallSpeedMax: 250,       // 下落速度上限
  bombChance: 0.28,        // 生成炸弹的概率
  planeHalf: 46,           // 飞机碰撞半宽
  bombRadius: 26,          // 炸弹碰撞半径
  targetRadius: 46,        // 手势目标卡片半径
  faceSmooth: 0.12,        // 鼻尖平滑系数（越大响应越快）
  planeKeySpeed: 620,      // 键盘移动速度（像素/秒，测试兜底）
  scorePerTarget: 10,      // 消除一个手势目标得分
  faceDetectEvery: 66,     // 面部检测间隔（毫秒，约 15fps）
};

let g3State = "intro";       // intro（开局倒计时）/ playing
let g3StateT = 0;
let g3Score = 0;
let g3Cleared = 0;           // 已消除的手势目标数
let g3Items = [];            // 画面上的掉落物：{type, x, y, vy, born}
let g3SpawnT = 0;            // 下次生成时间
let g3PlaneX = 0;            // 飞机当前位置（像素）
let g3PlaneSmooth = 0;       // 鼻尖目标的平滑位置
let g3NoseX = null;          // 鼻尖归一化横坐标（0..1，来自面部模型）
let g3FaceSeen = false;      // 最近一次面部检测是否看到人脸
let g3MatchFrames = 0;       // 当前目标的连续确认帧
let g3Msg = "";              // 反馈文字
let g3MsgT = 0;
let g3LastWrongHand = "";    // 上次提示过的手势（防止同一错误手势反复刷屏）
let g3NeedRelease = false;   // 消除后需"重新做一次"（松手或换手势）才能再消除
let g3LastMatchedGesture = ""; // 上次消除时的手势
let g3DangerFlash = false;   // 有手势目标接近危险线（警示变色）

// 面部模型（独立于手势模型，游戏三飞机用）
let faceLandmarker = null;
let faceOk = false;
let faceModelStatus = "面部模型加载中…";
let lastFaceDetectT = 0;

const FACE_MODEL_URLS = [
  "face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
];

// 加载 Face Landmarker（与手势模型一样优先用项目文件夹里的文件，失败再试 Google）
async function loadFaceLandmarker() {
  try {
    for (const base of MP_URLS) {
      let vision, fileset;
      try {
        vision = await import(`${base}/vision_bundle.mjs`);
        fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
      } catch (e) { continue; }
      for (const model of FACE_MODEL_URLS) {
        for (const delegate of ["GPU", "CPU"]) {
          try {
            faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: model, delegate },
              runningMode: "VIDEO",
              numFaces: 1,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
            });
            faceOk = true;
            faceModelStatus = "面部模型已加载";
            return;
          } catch (e) { /* 试下一个来源 */ }
        }
      }
    }
    faceModelStatus = "⚠ 缺少 face_landmarker.task：请下载并放入项目文件夹（与 gesture_recognizer.task 同目录）";
  } catch (e) {
    faceModelStatus = "⚠ 面部模型加载失败";
  }
}

// 面部追踪：只在新的视频帧到来时检测，并限制频率（约 15fps），避免每帧都跑模型。
// 注意：视频帧时间用独立的 lastFaceVideoTime，不能用手势的 lastVideoTime——
// draw() 里 updateHands() 先跑会更新 lastVideoTime，共用会让 updateFace() 永远认为没有新帧。
function updateFace() {
  if (!faceLandmarker) return;                       // 模型未就绪：由界面显示加载/失败状态
  if (!video || video.elt.readyState < 2) return;    // 摄像头未就绪
  if (video.elt.currentTime === lastFaceVideoTime) return;  // 不是新的摄像头画面（人脸专用帧时间）
  const now = millis();
  if (now - lastFaceDetectT < G3_CFG.faceDetectEvery) return;  // 频率限制
  lastFaceDetectT = now;
  try {
    const res = faceLandmarker.detectForVideo(video.elt, performance.now());
    lastFaceVideoTime = video.elt.currentTime;   // 只有真正跑过模型才记录该帧
    if (res.faceLandmarks && res.faceLandmarks.length > 0) {
      g3NoseX = res.faceLandmarks[0][1].x;   // 鼻尖是第 1 号关键点（归一化 0..1）
      g3FaceSeen = true;
    } else {
      g3FaceSeen = false;
    }
  } catch (e) {
    lastFaceVideoTime = video.elt.currentTime;
    g3FaceSeen = false;
  }
}

function startGame3() {
  currentGame = 3;
  gameState = "playing";
  hideMenu();
  g3State = "intro";
  g3StateT = millis();
  g3Score = 0;
  g3Cleared = 0;
  g3Items = [];
  g3Msg = ""; g3MsgT = 0;
  g3MatchFrames = 0;
  g3LastWrongHand = "";
  g3PlaneX = width / 2;
  g3PlaneSmooth = width / 2;
  g3SpawnT = millis() + G3_CFG.countdown * 1000 + 400;   // 倒计时结束后才开始生成
}

function g3LevelNow() {
  return min(G3_CFG.levelMax, 1 + floor(g3Score / G3_CFG.levelUpScore));
}
function g3FallSpeed() {
  return min(G3_CFG.fallSpeedMax, G3_CFG.fallSpeed + (g3LevelNow() - 1) * G3_CFG.fallSpeedPerLevel);
}
function g3SpawnInterval() {
  return max(G3_CFG.spawnIntervalMin, G3_CFG.spawnInterval - (g3LevelNow() - 1) * 0.35);
}
function g3DangerY() {
  return height - 170;
}
function g3PlaneY() {
  return height - 100;
}

// 当前可消除目标 = 位置最低（最接近危险线）的手势目标。
// 上方目标即使做出对应手势也不能提前消除——匹配只针对这个目标。
function g3CurrentTarget() {
  let best = null;
  for (const it of g3Items) {
    if (it.type === "bomb") continue;
    if (!best || it.y > best.y) best = it;
  }
  return best;
}

// 手势匹配：任意一只手、置信度 ≥ 阈值、连续 N 个新摄像头画面稳定；
// 消除后需要"重新做一次"手势（松手或换手势），防止保持同一手势连续消除多个目标
function checkG3Match(cur) {
  if (g3NeedRelease) { g3MatchFrames = 0; return false; }
  let idx = -1, best = -1;
  for (let i = 0; i < handGestures.length; i++) {
    if ((handScores[i] || 0) > best) { best = handScores[i] || 0; idx = i; }
  }
  if (idx < 0) { g3MatchFrames = 0; return false; }
  if (best < G3_CFG.matchConfidence || handGestures[idx] !== cur.type) {
    g3MatchFrames = 0;
    return false;
  }
  if (!handsUpdated) return g3MatchFrames >= G3_CFG.matchFrames;   // 没有新画面：维持已确认状态
  g3MatchFrames++;
  return g3MatchFrames >= G3_CFG.matchFrames;
}

function updateG3() {
  const now = millis();
  const dt = deltaTime / 1000;

  if (g3State === "intro") {
    if (now - g3StateT >= G3_CFG.countdown * 1000) g3State = "playing";
    updateG3Plane(dt);   // 倒计时期间飞机也跟随鼻尖，方便玩家就位
    return;
  }

  // 1) 生成掉落物：手势目标最多同时 2 个；炸弹概率生成；横向位置与现存目标错开
  if (now >= g3SpawnT) {
    g3SpawnT = now + g3SpawnInterval() * 1000;
    const targetCount = g3Items.filter((i) => i.type !== "bomb").length;
    let type;
    if (targetCount >= G3_CFG.maxTargets) type = "bomb";
    else if (random() < G3_CFG.bombChance) type = "bomb";
    else type = random(["rock", "scissors", "paper"]);
    let x = random(70, width - 70);
    for (let tries = 0; tries < 12; tries++) {
      let far = true;
      for (const it of g3Items) if (abs(it.x - x) < 130) { far = false; break; }
      if (far) break;
      x = random(70, width - 70);
    }
    g3Items.push({ type, x, y: -60, vy: g3FallSpeed(), born: now });
  }

  // 2) 掉落物下落
  for (const it of g3Items) it.y += it.vy * dt;

  // 3) 手势消除：只匹配当前最危险的目标（一次只消一个）
  // 消除后需要"重新做一次"（松手或换手势），防止保持同一手势连续消除多个目标
  if (g3NeedRelease) {
    if (playerGesture === "none" || playerGesture !== g3LastMatchedGesture) g3NeedRelease = false;
  }
  const cur = g3CurrentTarget();
  if (cur) {
    if (checkG3Match(cur)) {
      spawnBurst(cur.x, cur.y);
      g3Score += G3_CFG.scorePerTarget;
      g3Cleared++;
      g3Msg = "消除成功 +" + G3_CFG.scorePerTarget;
      g3MsgT = now;
      g3MatchFrames = 0;
      g3LastWrongHand = "";
      g3NeedRelease = true;
      g3LastMatchedGesture = cur.type;
      g3Items = g3Items.filter((i) => i !== cur);
    } else if (!g3NeedRelease && playerGesture !== "none" && playerGesture !== g3LastWrongHand) {
      // 识别到错误手势：短暂提示，不判负
      g3Msg = "手势不匹配 · 目标需要" + GESTURE_NAMES[cur.type];
      g3MsgT = now;
      g3LastWrongHand = playerGesture;
    }
  } else {
    g3MatchFrames = 0;
  }

  // 4) 失败判定：任意手势目标越过危险线
  const dangerY = g3DangerY();
  for (const it of g3Items) {
    if (it.type !== "bomb" && it.y - G3_CFG.targetRadius > dangerY) {
      gameOverReason = "手势目标越过危险线";
      gameState = "gameover";
      return;
    }
  }

  // 5) 炸弹：撞到飞机 → 失败；单独越过危险线或离开画面不判负
  const planeY = g3PlaneY();
  for (const it of g3Items) {
    if (it.type !== "bomb") continue;
    if (abs(it.x - g3PlaneX) < G3_CFG.planeHalf + G3_CFG.bombRadius &&
        it.y > planeY - 30 && it.y < planeY + 40) {
      gameOverReason = "飞机被炸弹击中";
      gameState = "gameover";
      return;
    }
  }
  const before = g3Items.length;
  g3Items = g3Items.filter((it) => it.y < height + 120);
  if (g3Items.length < before) {
    g3Msg = "躲开炸弹！";
    g3MsgT = now;
  }

  // 6) 飞机控制（鼻尖为主，键盘兜底）
  updateG3Plane(dt);

  // 7) 危险线警示：有手势目标接近时变色
  g3DangerFlash = false;
  for (const it of g3Items) {
    if (it.type !== "bomb" && it.y > dangerY - 90) { g3DangerFlash = true; break; }
  }
}

function updateG3Plane(dt) {
  // 鼻尖控制（主）：镜像映射（脸向左 → 飞机向左）+ 平滑 + 边界限制
  if (g3FaceSeen && g3NoseX !== null) {
    const targetX = (1 - g3NoseX) * width;
    g3PlaneSmooth = lerp(g3PlaneSmooth, targetX, G3_CFG.faceSmooth);
    g3PlaneX = constrain(g3PlaneSmooth, G3_CFG.planeHalf, width - G3_CFG.planeHalf);
  }
  // 人脸丢失：冻结飞机位置（不跳边缘、不判负），提示由 drawGame3 显示
  // 键盘兜底（摄像头不可用时的测试）：← / A = 左，→ / D = 右
  if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) {
    g3PlaneX = constrain(g3PlaneX - G3_CFG.planeKeySpeed * dt, G3_CFG.planeHalf, width - G3_CFG.planeHalf);
  }
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) {
    g3PlaneX = constrain(g3PlaneX + G3_CFG.planeKeySpeed * dt, G3_CFG.planeHalf, width - G3_CFG.planeHalf);
  }
}

function drawG3Item(it) {
  const cur = g3CurrentTarget();
  const isCur = it.type !== "bomb" && cur === it;
  push();
  translate(it.x, it.y);
  if (it.type === "bomb") {
    // 炸弹：警示色圆 + 轻微闪烁（不遮目标）
    const flick = 0.75 + 0.25 * sin(millis() / 90 + it.x);
    noStroke();
    fill(255, 60, 60, 110 * flick);
    circle(0, 0, G3_CFG.bombRadius * 2);
    stroke(255, 110, 110);
    strokeWeight(3);
    noFill();
    circle(0, 0, G3_CFG.bombRadius * 2);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(28);
    text("💣", 0, 0);
    fill(255, 200, 80);
    textSize(13);
    text("炸弹", 0, G3_CFG.bombRadius + 16);
    pop();
    return;
  }
  // 手势目标：卡片 + 边框；当前目标金色高亮 + "▼ 目标"标记
  const r = G3_CFG.targetRadius;
  noStroke();
  fill(30, 40, 56, 235);
  rect(-r, -r, r * 2, r * 2, 14);
  stroke(isCur ? color(255, 200, 80) : color(63, 168, 232));
  strokeWeight(isCur ? 5 : 3);
  noFill();
  rect(-r, -r, r * 2, r * 2, 14);
  noStroke();
  textAlign(CENTER, CENTER);
  fill(255);
  textSize(44);
  text(GESTURE_EMOJI[it.type], 0, -6);
  fill(150, 175, 205);
  textSize(15);
  text(GESTURE_NAMES[it.type], 0, r - 12);
  if (isCur) {
    fill(255, 200, 80);
    textSize(14);
    text("▼ 目标", 0, -r - 14);
  }
  pop();
}

// 飞机：原创几何图形（机身 + 双翼 + 驾驶舱），不依赖外部图片
function drawG3Plane() {
  const planeY = g3PlaneY();
  push();
  translate(g3PlaneX, planeY);
  noStroke();
  fill(140, 200, 255);
  triangle(-24, 14, 24, 14, 0, -34);
  fill(90, 150, 220);
  triangle(-14, 12, -30, 22, -14, 22);
  triangle(14, 12, 30, 22, 14, 22);
  fill(255, 200, 80);
  circle(0, -6, 8);
  pop();
}

function drawGame3() {
  push();
  const dangerY = g3DangerY();

  // 顶部 HUD：左侧信息面板（分数 / 难度 / 消除数）
  noStroke();
  fill(24, 32, 46, 205);
  rect(14, 12, 215, 92, 14);
  textAlign(LEFT, TOP);
  fill(255); textSize(18);
  text("分数 " + g3Score, 30, 22);
  fill(255, 200, 80); textSize(16);
  text("难度 L" + g3LevelNow(), 30, 50);
  fill(255); textSize(16);
  text("消除 " + g3Cleared + " 个", 30, 76);

  // 顶部右侧：手势识别状态 + 面部追踪状态
  // 面部状态区分四种情况：模型未加载 / 摄像头未就绪 / 未检测到人脸 / 检测到人脸（显示鼻尖横坐标）
  textAlign(RIGHT, TOP);
  textSize(15);
  fill(handStatusColor(0));
  text("手势： " + handStatusText(0), width - 18, 18);
  let faceTxt, faceCol;
  if (!faceOk) {
    faceTxt = faceModelStatus;
    faceCol = color(255, 150, 150);
  } else if (!video || video.elt.readyState < 2) {
    faceTxt = "等待摄像头…";
    faceCol = color(255, 200, 80);
  } else if (g3FaceSeen) {
    faceTxt = "检测到人脸 · 鼻尖x=" + (g3NoseX !== null ? g3NoseX.toFixed(2) : "?");
    faceCol = color(140, 255, 160);
  } else {
    faceTxt = "未检测到人脸 · 请把脸对准摄像头";
    faceCol = color(255, 200, 80);
  }
  fill(faceCol);
  text(faceTxt, width - 18, 42);
  // 键盘测试说明
  fill(120, 140, 170); textSize(12);
  text("键盘测试：←→/AD 移飞机 · 1/2/3 手势", width - 18, 68);

  // 危险线（接近目标时变红 + 短促警示条）
  strokeWeight(3);
  stroke(g3DangerFlash ? color(255, 90, 90) : color(255, 200, 80));
  line(30, dangerY, width - 30, dangerY);
  noStroke();
  fill(g3DangerFlash ? color(255, 90, 90) : color(255, 200, 80));
  textSize(13);
  text("危险线", 40, dangerY - 22);
  if (g3DangerFlash) {
    fill(255, 90, 90, 36);
    rect(0, dangerY - 8, width, 16);
  }

  // 掉落物（手势目标 / 炸弹）
  for (const it of g3Items) drawG3Item(it);

  // 飞机
  drawG3Plane();

  // 开局倒计时
  if (g3State === "intro") {
    const elapsed = millis() - g3StateT;
    const left = G3_CFG.countdown - elapsed / 1000;
    fill(10, 14, 20, 165);
    rect(0, height / 2 - 95, width, 190);
    fill(255); textSize(60);
    text(max(ceil(left), 0), width / 2, height / 2 - 30);
    fill(200, 220, 250); textSize(20);
    text("把手放进画面，脸对准摄像头", width / 2, height / 2 + 30);
    fill(150, 175, 205); textSize(15);
    text("手势消除目标 · 鼻尖移动飞机躲炸弹", width / 2, height / 2 + 62);
  }

  // 反馈文字（消除成功 / 手势不匹配 / 躲开炸弹，短暂显示）
  if (millis() - g3MsgT < 1100 && g3Msg) {
    const ok = g3Msg.indexOf("消除") === 0 || g3Msg.indexOf("躲开") === 0;
    fill(ok ? color(140, 255, 160) : color(255, 170, 80));
    textSize(20);
    text(g3Msg, width / 2, height / 2 - 60);
  }

  // 人脸丢失提示（持续显示，不判负）
  if (faceOk && !g3FaceSeen && g3State === "playing") {
    fill(255, 200, 80); textSize(15);
    text("⚠ 未检测到人脸：飞机已冻结 · 请回到摄像头画面", width / 2, height / 2 + 130);
  }
  pop();
}

function drawGameOver3() {
  push();
  fill(10, 14, 20, 210);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(255, 110, 110); textSize(44);
  text("游戏失败", width / 2, height / 2 - 140);
  fill(230, 240, 255); textSize(22);
  text(gameOverReason, width / 2, height / 2 - 80);
  fill(255); textSize(20);
  text("分数 " + g3Score + " · 消除 " + g3Cleared + " 个", width / 2, height / 2 - 40);
  btnRetry = { x: width / 2, y: height / 2 + 20, w: 240, h: 58 };
  noStroke();
  fill(63, 168, 232);
  rect(btnRetry.x - btnRetry.w / 2, btnRetry.y - btnRetry.h / 2, btnRetry.w, btnRetry.h, 29);
  fill(16, 22, 32); textSize(20);
  text("重新开始", btnRetry.x, btnRetry.y);
  fill(150, 175, 205); textSize(15);
  text("按 R 重玩 · 按 M 返回选择游戏", width / 2, btnRetry.y + btnRetry.h / 2 + 26);
  pop();
}
