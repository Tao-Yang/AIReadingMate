/* 可爱 3D 卡通机器人 —— 参考白头琥珀身小机器人形象，用 Three.js 基本体搭建。
 * 对外暴露 window.Robot：
 *   Robot.init(canvas)     初始化场景
 *   Robot.setState(state)  'idle' | 'thinking' | 'happy'
 */
(function () {
  const COLORS = {
    head: 0xeef1f5,      // 白色亮面脑袋
    headDark: 0xd6dbe3,
    amber: 0xf2a52b,     // 琥珀黄身体
    amberDark: 0xd98a1c,
    metal: 0xc2c8d2,     // 银色机械件
    metalDark: 0x8b93a1,
    glow: 0x33baff,      // 蓝色发光
    ring: 0xf5a623,      // 眼睛橙圈
    socket: 0x222a38,    // 眼窝深色
    nose: 0xf5a623,
    mouth: 0x39404d,
    panda: 0x1c1c1c,     // 熊猫黑
    pandaSoft: 0x4a4a4a,
    white: 0xffffff,
    red: 0xff5a5a,
  };

  let renderer, scene, camera, root;
  let head, eyeL, eyeR, leftArm, rightArm, antennaBall;
  let glowParts = [], sparkles = [];
  let clock;
  let state = "idle";
  let blinkTimer = 0;
  let nextBlink = 2 + Math.random() * 3;
  let stateUntil = 0;

  function sphere(r, color, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.4,
      metalness: opts.metalness ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), mat);
  }

  function cyl(rTop, rBot, h, color, metalness) {
    return new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, 20),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: metalness ?? 0.7 })
    );
  }

  function torus(r, tube, color, opts = {}) {
    return new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 16, 40),
      new THREE.MeshStandardMaterial({
        color, roughness: opts.roughness ?? 0.4, metalness: opts.metalness ?? 0.3,
        emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0,
      })
    );
  }

  function glowDisc(r, color) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.06, 28),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.2 })
    );
    m.rotation.x = Math.PI / 2;
    return m;
  }

  function buildEye(sign) {
    const g = new THREE.Group();
    // 熊猫黑眼圈（斜向水滴形）
    const patch = sphere(0.36, COLORS.panda, { roughness: 0.5 });
    patch.scale.set(0.66, 0.98, 0.3);
    patch.rotation.z = 0.45 * sign;
    patch.position.z = -0.04;
    // 蓝色发光眼珠
    const iris = sphere(0.17, COLORS.glow, { emissive: COLORS.glow, emissiveIntensity: 0.85, roughness: 0.2 });
    iris.scale.set(1, 1, 0.7); iris.position.z = 0.12;
    glowParts.push(iris);
    // 高光两点
    const hi1 = sphere(0.06, COLORS.white, { emissive: COLORS.white, emissiveIntensity: 0.8, roughness: 0.1 });
    hi1.position.set(-0.06 * sign, 0.08, 0.24);
    const hi2 = sphere(0.03, COLORS.white, { emissive: COLORS.white, emissiveIntensity: 0.8, roughness: 0.1 });
    hi2.position.set(0.07 * sign, -0.06, 0.24);
    g.add(patch, iris, hi1, hi2);
    return g;
  }

  function buildArm(sign) {
    // sign: -1 左, +1 右。整组以肩为轴，便于摆动。
    const g = new THREE.Group();
    g.position.set(0.82 * sign, -0.5, 0.15);
    // 肩部弹簧
    for (let i = 0; i < 3; i++) {
      const coil = torus(0.08, 0.03, COLORS.metalDark, { metalness: 0.8 });
      coil.rotation.y = Math.PI / 2;
      coil.position.x = 0.06 * sign * i;
      g.add(coil);
    }
    // 前臂
    const fore = cyl(0.06, 0.07, 0.5, COLORS.metal, 0.8);
    fore.position.set(0.28 * sign, -0.18, 0);
    fore.rotation.z = 0.5 * sign;
    g.add(fore);
    // 爪子
    const hand = sphere(0.12, COLORS.metalDark, { metalness: 0.8, roughness: 0.3 });
    hand.position.set(0.42 * sign, -0.38, 0);
    g.add(hand);
    for (let i = 0; i < 2; i++) {
      const claw = new THREE.Mesh(
        new THREE.ConeGeometry(0.045, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: COLORS.metal, metalness: 0.8, roughness: 0.3 })
      );
      claw.position.set(0.42 * sign + (i ? 0.07 : -0.07) * sign, -0.5, 0.05);
      claw.rotation.z = (i ? -0.3 : 0.3) * sign;
      g.add(claw);
    }
    return g;
  }

  function buildFoot(sign) {
    const g = new THREE.Group();
    // 弹簧腿
    const spring = cyl(0.05, 0.05, 0.4, COLORS.metalDark, 0.7);
    spring.position.set(0.32 * sign, -1.35, 0.05);
    g.add(spring);
    // 白色圆顶靴
    const boot = sphere(0.36, COLORS.head, { roughness: 0.35 });
    boot.scale.set(1, 0.6, 1.25);
    boot.position.set(0.36 * sign, -1.68, 0.1);
    g.add(boot);
    const rim = torus(0.34, 0.05, COLORS.metalDark, { metalness: 0.6 });
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0.36 * sign, -1.62, 0.1);
    rim.scale.set(1, 1.25, 1);
    g.add(rim);
    if (sign < 0) {
      const dot = sphere(0.04, COLORS.red, { emissive: COLORS.red, emissiveIntensity: 0.6 });
      dot.position.set(0.36 * sign, -1.6, 0.62);
      g.add(dot);
    }
    return g;
  }

  function buildRobot() {
    root = new THREE.Group();

    // ---- 身体（琥珀黄）----
    const body = sphere(0.82, COLORS.amber, { roughness: 0.35 });
    body.scale.set(1.05, 1.0, 0.92);
    body.position.y = -0.62;
    root.add(body);
    // 颈部银环
    const collar = torus(0.52, 0.09, COLORS.metal, { metalness: 0.8 });
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.02;
    collar.scale.set(1, 1, 0.6);
    root.add(collar);
    // 肚脐蓝色发光按钮
    const bellyRing = torus(0.2, 0.05, COLORS.metalDark, { metalness: 0.7 });
    bellyRing.position.set(0, -0.62, 0.74);
    const belly = glowDisc(0.16, COLORS.glow);
    belly.position.set(0, -0.62, 0.76);
    glowParts.push(belly);
    root.add(bellyRing, belly);
    // 胸口小螺栓
    [-0.3, 0.3].forEach((x) => {
      const bolt = sphere(0.05, COLORS.metalDark, { metalness: 0.8 });
      bolt.position.set(x, -0.18, 0.66);
      root.add(bolt);
    });

    // ---- 头（琥珀黄圆顶 + 熊猫面孔）----
    head = new THREE.Group();
    head.position.y = 0.9;
    const dome = sphere(1.1, COLORS.amber, { roughness: 0.3 });
    dome.scale.set(1.18, 1.04, 1.08);
    head.add(dome);

    // 熊猫黑耳朵
    [-1, 1].forEach((sign) => {
      const ear = sphere(0.34, COLORS.panda, { roughness: 0.5 });
      ear.scale.set(1, 1, 0.5);
      ear.position.set(0.8 * sign, 0.92, -0.1);
      head.add(ear);
      const inner = sphere(0.17, COLORS.pandaSoft, { roughness: 0.6 });
      inner.scale.set(1, 1, 0.5);
      inner.position.set(0.8 * sign, 0.92, 0.06);
      head.add(inner);
    });

    // 眼睛（含熊猫黑眼圈）
    eyeL = buildEye(-1); eyeL.position.set(-0.46, 0.08, 0.86);
    eyeR = buildEye(1); eyeR.position.set(0.46, 0.08, 0.86);
    head.add(eyeL, eyeR);

    // 熊猫黑鼻子
    const nose = sphere(0.12, COLORS.panda, { roughness: 0.35 });
    nose.scale.set(1.25, 0.8, 0.7);
    nose.position.set(0, -0.26, 1.04);
    head.add(nose);

    // 微笑小嘴
    const mouth = torus(0.13, 0.03, COLORS.panda, {});
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -0.52, 0.98);
    mouth.scale.set(1, 0.7, 1);
    head.add(mouth);

    root.add(head);

    // ---- 四肢 ----
    leftArm = buildArm(-1);
    rightArm = buildArm(1);
    root.add(leftArm, rightArm);
    root.add(buildFoot(-1), buildFoot(1));

    // 开心时上升的蓝色小星点（默认隐藏）
    sparkles = [];
    for (let i = 0; i < 4; i++) {
      const s = sphere(0.06, COLORS.glow, { emissive: COLORS.glow, emissiveIntensity: 0.9 });
      s.visible = false;
      root.add(s);
      sparkles.push(s);
    }

    scene.add(root);
  }

  function onResize(canvas) {
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    // 漂浮 + 摆头
    root.position.y = Math.sin(t * 1.7) * 0.09;
    const targetRotY = state === "thinking" ? Math.sin(t * 6) * 0.14 : Math.sin(t * 0.8) * 0.2 - 0.05;
    head.rotation.y += (targetRotY - head.rotation.y) * 0.08;
    head.rotation.z = Math.sin(t * 1.2) * 0.05;

    // 蓝光呼吸
    const pulse = state === "thinking" ? 0.6 + Math.abs(Math.sin(t * 8)) * 0.8
      : state === "happy" ? 1.1
      : 0.7 + Math.sin(t * 2) * 0.25;
    glowParts.forEach((m) => (m.material.emissiveIntensity = pulse));

    // 眨眼 / 眯眼
    blinkTimer += dt;
    let eyeScaleY = 1;
    if (state === "happy") {
      eyeScaleY = 0.35;                              // 开心眯眼
    } else if (blinkTimer > nextBlink) {
      const p = (blinkTimer - nextBlink) / 0.14;
      eyeScaleY = p < 1 ? 1 - Math.sin(p * Math.PI) * 0.9 : 1;
      if (p >= 1) { blinkTimer = 0; nextBlink = 2 + Math.random() * 3; }
    }
    eyeL.scale.y = eyeScaleY;
    eyeR.scale.y = eyeScaleY;

    if (state === "thinking") {
      leftArm.rotation.z = Math.sin(t * 7) * 0.5;    // 挥动手臂
      rightArm.rotation.z = -Math.sin(t * 7) * 0.5;
      sparkles.forEach((s) => (s.visible = false));
    } else if (state === "happy") {
      const bounce = Math.abs(Math.sin(t * 11));
      root.position.y += bounce * 0.08;              // 蹦跳
      leftArm.rotation.z = 0.9 + bounce * 0.4;       // 举手欢呼
      rightArm.rotation.z = -0.9 - bounce * 0.4;
      sparkles.forEach((s, i) => {                   // 冒蓝色星点
        s.visible = true;
        const life = (t * 0.9 + i * 0.25) % 1;
        s.position.set((i - 1.5) * 0.4, 0.9 + life * 1.5, 0.5);
        s.scale.setScalar(1 - life);
      });
      if (t > stateUntil) setState("idle");
    } else {
      leftArm.rotation.z += (0 - leftArm.rotation.z) * 0.1;
      rightArm.rotation.z += (0 - rightArm.rotation.z) * 0.1;
      sparkles.forEach((s) => (s.visible = false));
    }

    renderer.render(scene, camera);
  }

  const Robot = {
    init(canvas) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0.35, 7.8);
      camera.lookAt(0, 0.15, 0);

      const amb = new THREE.AmbientLight(0xffffff, 0.75);
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(2, 3, 4);
      const rim = new THREE.DirectionalLight(0x9fd0ff, 0.6);
      rim.position.set(-3, 1, -2);
      const fill = new THREE.DirectionalLight(0xffe6b0, 0.35);
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
      if (next === "happy") stateUntil = clock.elapsedTime + 1.6;
    },
  };

  window.Robot = Robot;
})();
