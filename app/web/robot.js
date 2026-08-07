/* 可爱 3D 卡通机器人 —— 鲜艳萌动的小绿芽熊猫精灵机器人，使用 Three.js 搭建。
 * 对外暴露 window.Robot：
 *   Robot.init(canvas)     初始化场景
 *   Robot.setState(state)  'idle' | 'thinking' | 'happy'
 */
(function () {
  const COLORS = {
    skin: 0xffe2d2,       // 温润凝脂肤色
    hair: 0x1c1919,       // 乌黑发丝
    dressRed: 0xbd4b4b,   // 优雅朱砂红
    dressGreen: 0x4a7c59, // 沉静石绿/碧玉
    gold: 0xd4af37,       // 簪子金辉
    white: 0xffffff,
    pink: 0xff9aa2,       // 娇羞腮红与落花
    mouth: 0x8a2323,      // 绛唇色
  };

  let renderer, scene, camera, root;
  let head, eyeL, eyeR, eyeHi = [], happyEyes, mouth, blinkGroup;
  let leftArm, rightArm, sleeves = [];
  let hairpinL, hairpinR, petals = [];
  let clock;
  let state = "idle";
  let blinkTimer = 0;
  let nextBlink = 2.5 + Math.random() * 3;
  let stateUntil = 0;

  function sphere(r, color, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.45,
      metalness: opts.metalness ?? 0.02,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(r, 28, 28), mat);
  }

  function cyl(rTop, rBot, h, color, opts = {}) {
    return new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, 18),
      new THREE.MeshStandardMaterial({
        color, roughness: opts.roughness ?? 0.4, metalness: opts.metalness ?? 0.05
      })
    );
  }

  function torus(r, tube, color, opts = {}) {
    return new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 12, 32),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.5, metalness: opts.metalness ?? 0.05
      })
    );
  }

  function buildPetal() {
    // 绛雪落英（小花瓣形：扁平球）
    const p = sphere(0.12, COLORS.pink, { roughness: 0.6 });
    p.scale.set(1.0, 0.4, 0.7);
    return p;
  }

  function buildRobot() {
    root = new THREE.Group();

    // ---- 1. 下裙（碧绿百褶长裙）----
    const skirt = cyl(0.3, 0.78, 1.6, COLORS.dressGreen, { roughness: 0.5 });
    skirt.position.y = -0.7;
    root.add(skirt);

    // 裙摆饰金边
    const goldTrim = torus(0.76, 0.04, COLORS.gold, { metalness: 0.7 });
    goldTrim.rotation.x = Math.PI / 2;
    goldTrim.position.y = -1.48;
    root.add(goldTrim);

    // ---- 2. 上衫（朱砂襦裙外衣）----
    const chest = cyl(0.38, 0.3, 0.55, COLORS.dressRed, { roughness: 0.45 });
    chest.position.y = 0.22;
    root.add(chest);

    // 交领右衽领口
    const collar = torus(0.34, 0.04, COLORS.white);
    collar.rotation.x = Math.PI / 2.3;
    collar.position.set(0, 0.38, 0.1);
    root.add(collar);

    // ---- 3. 头部（温润娇憨）----
    head = new THREE.Group();
    head.position.y = 0.98;
    const skull = sphere(0.85, COLORS.skin, { roughness: 0.5 });
    head.add(skull);

    // ---- 4. 古典青丝发髻 ----
    const hairBack = sphere(0.9, COLORS.hair, { roughness: 0.6 });
    hairBack.scale.set(1.04, 1.0, 0.94);
    hairBack.position.set(0, 0.1, -0.1);
    head.add(hairBack);

    // 额前齐眉弯刘海
    const bangs = sphere(0.86, COLORS.hair, { roughness: 0.6 });
    bangs.scale.set(1.02, 0.5, 0.4);
    bangs.position.set(0, 0.48, 0.66);
    bangs.rotation.x = -0.3;
    head.add(bangs);

    // 两侧飞鬓
    [-1, 1].forEach((sign) => {
      const lock = sphere(0.18, COLORS.hair, { roughness: 0.6 });
      lock.scale.set(0.8, 1.8, 0.6);
      lock.position.set(0.82 * sign, -0.05, 0.3);
      head.add(lock);
    });

    // 高耸云髻（典雅发包）
    const bun = sphere(0.42, COLORS.hair, { roughness: 0.6 });
    bun.scale.set(1.2, 0.8, 0.8);
    bun.position.set(0, 0.96, -0.2);
    head.add(bun);

    // 金钗玉簪（步摇）
    [-1, 1].forEach((sign) => {
      const pin = new THREE.Group();
      pin.position.set(0.35 * sign, 1.0, -0.1);
      pin.rotation.z = -0.5 * sign;
      pin.rotation.y = 0.2 * sign;

      const stick = cyl(0.02, 0.02, 0.5, COLORS.gold, { metalness: 0.8 });
      stick.rotation.z = Math.PI / 2;
      stick.position.x = 0.2 * sign;

      const bead = sphere(0.08, COLORS.gold, { metalness: 0.8 });
      bead.position.x = 0.45 * sign;
      pin.add(stick, bead);

      // 垂吊流苏步摇
      const fringe = cyl(0.01, 0.01, 0.22, COLORS.pink);
      fringe.position.set(0.45 * sign, -0.11, 0);
      pin.add(fringe);

      head.add(pin);
    });

    // ---- 5. 盈润桃花面 ----
    // 恬静凤眼
    blinkGroup = new THREE.Group();
    const eyeGeo = new THREE.SphereGeometry(0.15, 24, 24);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1f1919, roughness: 0.1 });
    eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.35, 0.06, 0.74);
    eyeL.scale.set(0.9, 1.0, 0.55);
    eyeR = eyeL.clone();
    eyeR.position.x = 0.35;
    blinkGroup.add(eyeL, eyeR);

    // 水波高光（两点盈盈秋水）
    eyeHi = [];
    [[-0.39, 0.12], [0.31, 0.12]].forEach(([x, y]) => {
      const hi = sphere(0.05, COLORS.white, { roughness: 0.1 });
      hi.position.set(x, y, 0.86);
      blinkGroup.add(hi);
      eyeHi.push(hi);
    });
    head.add(blinkGroup);

    // 眯眼弯蛾眉 ^_^（笑颜，默认隐藏）
    happyEyes = new THREE.Group();
    [-0.35, 0.35].forEach((x) => {
      const brow = torus(0.15, 0.026, 0x1f1919);
      brow.position.set(x, 0.06, 0.76);
      brow.rotation.x = Math.PI / 2.3;
      happyEyes.add(brow);
    });
    happyEyes.visible = false;
    head.add(happyEyes);

    // 点绛唇
    mouth = torus(0.09, 0.022, COLORS.mouth);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -0.3, 0.78);
    mouth.scale.set(1, 0.6, 1);
    head.add(mouth);

    // 人面桃花相映红（双颊腮红）
    [-1, 1].forEach((sign) => {
      const blush = sphere(0.13, COLORS.pink, { transparent: true, opacity: 0.55, roughness: 1 });
      blush.scale.set(1.0, 0.65, 0.3);
      blush.position.set(0.55 * sign, -0.09, 0.75);
      head.add(blush);
    });

    root.add(head);

    // ---- 6. 飘逸大袖（飞天长袖袍，以肩为轴）----
    // 左臂组
    leftArm = new THREE.Group();
    leftArm.position.set(-0.52, 0.36, 0);
    const sleeveL = cyl(0.14, 0.38, 0.8, COLORS.dressRed, { roughness: 0.5 });
    sleeveL.rotation.z = -0.5;
    sleeveL.position.set(-0.2, -0.26, 0);
    leftArm.add(sleeveL);
    const handL = sphere(0.09, COLORS.skin);
    handL.position.set(-0.38, -0.58, 0.02);
    leftArm.add(handL);
    root.add(leftArm);

    // 右臂组
    rightArm = new THREE.Group();
    rightArm.position.set(0.52, 0.36, 0);
    const sleeveR = cyl(0.14, 0.38, 0.8, COLORS.dressRed, { roughness: 0.5 });
    sleeveR.rotation.z = 0.5;
    sleeveR.position.set(0.2, -0.26, 0);
    rightArm.add(sleeveR);
    const handR = sphere(0.09, COLORS.skin);
    handR.position.set(0.38, -0.58, 0.02);
    rightArm.add(handR);
    root.add(rightArm);

    // 仙风带环（萦绕在后方的披帛披纱，极富流动感）
    const ribbon = torus(0.9, 0.045, COLORS.white, { metalness: 0.1 });
    ribbon.scale.set(1.2, 0.58, 1.4);
    ribbon.position.set(0, -0.14, -0.22);
    ribbon.rotation.x = 0.12;
    root.add(ribbon);

    // ---- 7. 开心时飞舞的落英花瓣 ----
    petals = [];
    for (let i = 0; i < 5; i++) {
      const p = buildPetal();
      p.visible = false;
      root.add(p);
      petals.push(p);
    }

    scene.add(root);
  }

  function onResize(canvas) {
    const w = canvas.clientWidth || 210;
    const h = canvas.clientHeight || 210;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setHappyEyes(on) {
    happyEyes.visible = on;
    blinkGroup.visible = !on;
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    // 温婉御风漂浮（比机器人更慢、更温柔）
    root.position.y = Math.sin(t * 1.2) * 0.06;
    // 螓首轻转（温柔地微偏头、颔首俯看）
    const targetRotY = state === "thinking" ? Math.sin(t * 5) * 0.08 : Math.sin(t * 0.6) * 0.14 - 0.08;
    head.rotation.y += (targetRotY - head.rotation.y) * 0.08;
    head.rotation.z = Math.sin(t * 0.8) * 0.03 + (state === "thinking" ? 0.08 : 0);

    // 流苏步摇随风款款摇晃
    head.children.forEach((c) => {
      if (c.rotation && c.position.y > 0.9) {
        c.rotation.z += Math.sin(t * 4) * 0.005;
      }
    });

    // 眨眼（文静徐缓）
    blinkTimer += dt;
    let eyeScaleY = 1;
    if (state === "happy") {
      eyeScaleY = 0.35;
    } else if (blinkTimer > nextBlink) {
      const p = (blinkTimer - nextBlink) / 0.18;
      eyeScaleY = p < 1 ? 1 - Math.sin(p * Math.PI) * 0.95 : 1;
      if (p >= 1) { blinkTimer = 0; nextBlink = 3 + Math.random() * 4; }
    }
    blinkGroup.scale.y = eyeScaleY;

    if (state === "thinking") {
      setHappyEyes(false);
      // 抚面托腮：左袖挽起，温柔抚口，掩面娇羞
      leftArm.rotation.set(-0.3, 0.4, 1.28);
      rightArm.rotation.set(0, 0, -0.4);
      petals.forEach((p) => (p.visible = false));
    } else if (state === "happy") {
      setHappyEyes(true);
      const bounce = Math.abs(Math.sin(t * 10));
      root.position.y += bounce * 0.04;              // 文静轻跃
      leftArm.rotation.set(-0.1, 0, 0.8 + bounce * 0.3); // 挥舞仙袖
      rightArm.rotation.set(-0.1, 0, -0.8 - bounce * 0.3);

      // 绛雪飘落（樱粉桃花瓣围绕在身边翩跹起舞）
      petals.forEach((p, i) => {
        p.visible = true;
        const life = (t * 0.8 + i * 0.2) % 1;
        p.position.set(
          Math.sin(t * 3.5 + i) * 0.6 + (i - 2) * 0.15,
          0.8 - life * 1.6,
          0.5 + Math.cos(t * 3.5 + i) * 0.3
        );
        p.rotation.set(t * 2 + i, t * 1.5, t * i);
        p.scale.setScalar(0.12 * (1 - life * 0.5));
      });
      if (t > stateUntil) setState("idle");
    } else {
      setHappyEyes(false);
      // idle 状态：双手在身前轻交，端庄淑雅
      leftArm.rotation.set(-0.1, 0.2, 0.5 + Math.sin(t * 1.2) * 0.04);
      rightArm.rotation.set(-0.1, -0.2, -0.5 - Math.sin(t * 1.2) * 0.04);
      petals.forEach((p) => (p.visible = false));
    }

    renderer.render(scene, camera);
  }

  const Robot = {
    init(canvas) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
      camera.position.set(0, 0.45, 7.8);
      camera.lookAt(0, 0.1, 0);

      const amb = new THREE.AmbientLight(0xffffff, 0.85);
      const key = new THREE.DirectionalLight(0xfff8e8, 1.0); // 暖日柔光
      key.position.set(3, 4, 3);
      const rim = new THREE.DirectionalLight(0xffdfcb, 0.5); // 桃花腮边缘返光
      rim.position.set(-3, 1, -2);
      const fill = new THREE.DirectionalLight(0xdbe9ff, 0.28); // 远山翠微倒影底光
      fill.position.set(0, -2, 3);
      scene.add(amb, key, rim, fill);

      clock = new THREE.Clock();
      buildRobot();
      onResize(canvas);
      window.addEventListener("resize", () => onResize(canvas));
      animate();
    },
    setState(next) {
      state = next;
      if (next === "happy") stateUntil = clock.elapsedTime + 1.8;
    },
  };

  window.Robot = Robot;
})();
