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

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  select("#start").mouseClicked(startExperience);
  // 直接双击打开时（file: 协议），浏览器会禁用摄像头，给出明确提示
  if (window.location.protocol === "file:") {
    const warn = select("#filewarn");
    if (warn) warn.style("display", "block");
  }
}

function startExperience() {
  if (started) return;
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
  loadHandLandmarker();
}

function draw() {
  background(20, 26, 34);
  if (started) {
    updateHands();
    if (showCamera) drawCamera();
    if (showSkeleton) drawSkeleton();
    // 临时占位：识别已就绪，游戏逻辑下一步实现
    push();
    textAlign(CENTER, TOP);
    fill(255);
    textSize(26);
    text("石头剪刀布 · 手势对决", width / 2, 18);
    fill(150, 175, 205);
    textSize(14);
    text("手势识别已就绪，三个游戏逻辑将由 Qwen 在下一步写入", width / 2, 58);
    pop();
  }
}

function keyPressed() {
  if (key === "k" || key === "K") showSkeleton = !showSkeleton;
  if (key === "c" || key === "C") showCamera = !showCamera;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
