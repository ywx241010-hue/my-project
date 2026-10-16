// =====================================================================
//  《石头剪刀布 · 手势对决》— 起始文件 / starter
//  PART A（下面）是手部识别引擎，不要修改。/ PART A (below) is the hand engine: don't change it.
//  PART B（最底部）是空的，由 Qwen 逐步写入游戏逻辑。
//  PART B (at the bottom) is empty and Qwen will write it.
// =====================================================================


// ---------------------------------------------------------------------
//  PART A — 手部识别引擎（不要修改）
//  PART A — hand engine (don't change it)
//
//  它打开摄像头的"眼睛"（Google 的 MediaPipe 手部模型），
//  每一帧把看到的每只手写进列表 hands：
//  每只手 = 21 个点 {x, y, z}，x、y 是画布像素坐标（已经镜像）。
//  It switches on the camera's "eyes" (Google's MediaPipe hand model)
//  and, every frame, writes where each hand is into a list called hands.
//  两只手最多都能识别到（numHands = 2）/ up to two hands (numHands = 2)
// ---------------------------------------------------------------------
const MP_VERSION = "0.10.21";
// MediaPipe 的两个下载来源：先用国内镜像 npmmirror，失败再用 jsDelivr
const MP_URLS = [
  `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`,
];
// 手部模型：先找项目文件夹里的 hand_landmarker.task，没有再从 Google 下载
const MODEL_URLS = [
  "hand_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
];

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

let video;                 // 摄像头画面 / the webcam
let handLandmarker = null; // MediaPipe 手部模型 / the hand model
let hands = [];            // 每一帧：看到的所有手（最多 2 只）。每只手 = 21 个点 {x, y, z}
                           // every frame: the hands the camera sees (max 2); each = 21 points {x, y, z}
                           // x、y 是画布像素坐标（已经镜像）/ x, y are canvas pixels (already mirrored)
let lastVideoTime = -1;
let started = false;
let showCamera = false;
let showSkeleton = false;

async function loadHandLandmarker() {
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
          handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
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
  setStatus("⚠️ 手势模型加载失败：请把 hand_landmarker.task 放进项目文件夹 / Hand model failed to load: put hand_landmarker.task in the project folder");
}

// 每一帧调用一次 / call once per frame
let cameraOk = null;
function updateHands() {
  if (!handLandmarker || !video) return;
  const ok = video.elt.readyState >= 2;
  if (ok !== cameraOk) {
    cameraOk = ok;
    setStatus(ok ? "手势识别已就绪 ✋ / Hand tracking is ready"
                 : "正在等待摄像头… / Waiting for the camera…");
  }
  if (!ok) return;
  if (video.elt.currentTime === lastVideoTime) return;
  lastVideoTime = video.elt.currentTime;

  const result = handLandmarker.detectForVideo(video.elt, performance.now());
  hands = result.landmarks.map((pts) =>
    pts.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z }))
  );
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

// ============ 公共基础 1：手势分类（石头 / 剪刀 / 布 / 未识别）============
const GESTURES = ["rock", "scissors", "paper"];
const GESTURE_NAMES = { rock: "石头", scissors: "剪刀", paper: "布" };
const GESTURE_EMOJI = { rock: "✊", scissors: "✌️", paper: "🖐" };
const GESTURE_KEYS = { "1": "rock", "2": "scissors", "3": "paper" };

// 依据 21 个关键点判断手势：
// 逐手指比较"指尖到指根"和"指根到掌根"的距离，前者更长就认为该手指伸直。
// 食指、中指放宽（0.6）：剪刀即使没完全伸直也能识别；
// 无名指、小指收紧（1.1）：只有明显伸直才算，剪刀时微微翘起不会误判。
// 四指全屈 = 石头；只有食指、中指伸直 = 剪刀；四指全伸 = 布；其他 = 未识别。
function classifyHand(hand) {
  if (!hand) return "none";
  const d = (a, b) => dist(hand[a].x, hand[a].y, hand[b].x, hand[b].y);
  const index = d(HAND.INDEX_TIP, HAND.INDEX_PIP) > d(HAND.INDEX_PIP, HAND.INDEX_MCP) * 0.6;
  const middle = d(HAND.MIDDLE_TIP, HAND.MIDDLE_PIP) > d(HAND.MIDDLE_PIP, HAND.MIDDLE_MCP) * 0.6;
  const ring = d(HAND.RING_TIP, HAND.RING_PIP) > d(HAND.RING_PIP, HAND.RING_MCP) * 1.1;
  const pinky = d(HAND.PINKY_TIP, HAND.PINKY_PIP) > d(HAND.PINKY_PIP, HAND.PINKY_MCP) * 1.1;
  if (!index && !middle && !ring && !pinky) return "rock";
  if (index && middle && !ring && !pinky) return "scissors";
  if (index && middle && ring && pinky) return "paper";
  return "none";
}

// ============ 公共基础 2：5 帧投票 + 变化沿触发 ============
// 每帧把手势写进最近 5 帧的窗口，窗口内出现最多的手势才算数（至少 3 票）。
// 这样轻微抖动不会打断确认，换手势后最多 3 帧就能跟上。
let frameGesture = "none";         // 当前稳定识别出的手势
let lastGesture = "none";          // 上一次"已确认并已发出"的手势
let gestureHistory = [];           // 最近 5 帧的手势窗口
let lastGestureEvent = { g: "none", t: 0 }; // 最近一次手势变化事件
let lastConsumedT = 0;             // 游戏已经处理过的事件时间

function updateGesture() {
  const g = hands.length ? classifyHand(hands[0]) : "none";
  gestureHistory.push(g);
  if (gestureHistory.length > 5) gestureHistory.shift();
  const counts = {};
  for (const x of gestureHistory) if (x !== "none") counts[x] = (counts[x] || 0) + 1;
  let best = "none", bestN = 0;
  for (const k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  frameGesture = bestN >= 3 ? best : "none";
  if (frameGesture !== "none" && frameGesture !== lastGesture) {
    lastGesture = frameGesture;
    onGestureChanged(frameGesture);
  }
}

function onGestureChanged(g) {
  if (g !== "none") lastGestureEvent = { g, t: millis() };
}

// ============ 公共基础 3：游戏外壳 ============
let gameState = "menu";    // menu / playing / gameover

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  select("#start").mouseClicked(startExperience);
  // 直接双击打开时（file: 协议），浏览器会禁用摄像头，给出明确提示
  if (window.location.protocol === "file:") {
    const warn = select("#filewarn");
    if (warn) warn.style("display", "block");
  }
  // 页面打开时就预加载手势模型，点"开始"后不用等，立刻进游戏
  loadHandLandmarker();
}

async function startExperience() {
  if (started) {
    // 从"返回封面"再次开始时，摄像头和模型都在，直接进游戏
    startGame2();
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
  // 这里直接进游戏，模型加载期间键盘兜底 1/2/3 仍然可玩。
  startGame2();
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
  gameState = "playing";
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
  // 左上 HUD
  textAlign(LEFT, TOP);
  fill(255); textSize(18);
  text("得分 " + score, 20, 16);
  text("连击 x" + combo, 20, 40);
  text("档位 L" + level, 20, 64);
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
  // 玩家识别结果
  fill(150, 175, 205); textSize(18);
  const shown = frameGesture === "none" ? "未识别" : GESTURE_NAMES[frameGesture];
  text("识别： " + shown, width / 2, height - 80);
  // 上一轮记录
  if (lastPlayerGesture !== "none") {
    fill(120, 140, 170); textSize(14);
    text("上一轮你出了：" + GESTURE_NAMES[lastPlayerGesture], width / 2, height - 50);
  }
  // 反馈
  if (millis() - feedbackT < 1500) {
    fill(255, 200, 80); textSize(20);
    text(feedback, width / 2, height / 2 + 84);
  }
  pop();
}

function drawGameOver() {
  push();
  fill(10, 14, 20, 200);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(255, 90, 90); textSize(44);
  text("游戏结束", width / 2, height / 2 - 120);
  fill(230, 240, 255); textSize(20);
  text(gameOverReason, width / 2, height / 2 - 60);
  text("得分 " + score + " · 最高连击 x" + combo, width / 2, height / 2 - 20);
  fill(150, 175, 205); textSize(16);
  text("按 R 重新开始 · 按 M 返回封面", width / 2, height / 2 + 30);
  pop();
}

function backToMenu() {
  gameState = "menu";
  select("#intro").style("display", "flex");
}

function draw() {
  background(20, 26, 34);
  if (!started) return;
  updateHands();
  if (showCamera) drawCamera();
  if (showSkeleton) drawSkeleton();
  updateGesture();
  if (gameState === "playing") {
    updateGame2();
    drawGame2();
  } else if (gameState === "gameover") {
    drawGameOver();
  }
}

function keyPressed() {
  if (key === "k" || key === "K") showSkeleton = !showSkeleton;
  if (key === "c" || key === "C") showCamera = !showCamera;
  // 键盘兜底：1 / 2 / 3 模拟石头 / 剪刀 / 布
  if (GESTURE_KEYS[key]) onGestureChanged(GESTURE_KEYS[key]);
  if (gameState === "gameover") {
    if (key === "r" || key === "R") startGame2();
    if (key === "m" || key === "M") backToMenu();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
