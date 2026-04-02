// Solar System Visualization - Interactive 3D Solar System with Three.js
// React, useState, useEffect, useRef, useCallback, THREE, OrbitControls
// are provided by DynamicModuleLoader (no imports needed)

type CelestialBodyType = 'star' | 'planet' | 'moon';

type CelestialBody = {
  name: string;
  type: CelestialBodyType;
  radius: number;
  realRadius: number;
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  orbitalRadius: number;
  realOrbitalRadius: number;
  orbitalPeriod: number;
  rotationPeriod: number;
  inclination: number;
  axialTilt: number;
  description: string;
  facts: string[];
  parentBody?: string;
};

type MoonData = {
  body: CelestialBody;
  mesh: THREE.Mesh;
  orbitLine: THREE.Line;
  currentAngle: number;
};

type PlanetData = {
  body: CelestialBody;
  mesh: THREE.Mesh;
  group: THREE.Group;
  orbitLine: THREE.Line;
  currentAngle: number;
  moons: Map<string, MoonData>;
};

// Color constants
const COLORS = {
  sceneBackground: 0x0a0a1a,
  sunGlow: 0xff6600,
  sunCorona: 0xff4400,
  sunHalo: 0xff2200,
  sunLight: 0xffffee,
  orbitLine: 0x334466,
  moonOrbitLine: 0x444466,
} as const;

const PLANET_NAMES = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;

const CELESTIAL_BODIES: Record<string, CelestialBody> = {
  sun: {
    name: 'Sun',
    type: 'star',
    radius: 4,
    realRadius: 696340,
    color: 0xffdd33,
    emissive: 0xff8800,
    emissiveIntensity: 1.0,
    orbitalRadius: 0,
    realOrbitalRadius: 0,
    orbitalPeriod: 0,
    rotationPeriod: 609.12,
    inclination: 0,
    axialTilt: 7.25,
    description: 'The Sun is the star at the center of our Solar System, containing 99.86% of the system\'s mass.',
    facts: [
      'Surface temperature: 5,500°C',
      'Core temperature: 15 million°C',
      'Age: 4.6 billion years'
    ]
  },
  mercury: {
    name: 'Mercury',
    type: 'planet',
    radius: 0.4,
    realRadius: 2439.7,
    color: 0xb0b0b0,
    orbitalRadius: 10,
    realOrbitalRadius: 57909050,
    orbitalPeriod: 88,
    rotationPeriod: 1407.6,
    inclination: 7.0,
    axialTilt: 0.034,
    description: 'Mercury is the smallest planet and closest to the Sun.',
    facts: ['No moons', 'Fastest orbit: 88 Earth days', 'Extreme temperature swings']
  },
  venus: {
    name: 'Venus',
    type: 'planet',
    radius: 0.95,
    realRadius: 6051.8,
    color: 0xe6c39a,
    orbitalRadius: 14,
    realOrbitalRadius: 108208930,
    orbitalPeriod: 225,
    rotationPeriod: -5832.5,
    inclination: 3.4,
    axialTilt: 177.4,
    description: 'Venus is the hottest planet due to its dense atmosphere and runaway greenhouse effect.',
    facts: ['Rotates backwards (retrograde)', 'Day longer than year', 'Surface temp: 465°C']
  },
  earth: {
    name: 'Earth',
    type: 'planet',
    radius: 1.0,
    realRadius: 6371,
    color: 0x6b93d6,
    orbitalRadius: 18,
    realOrbitalRadius: 149598023,
    orbitalPeriod: 365.25,
    rotationPeriod: 24,
    inclination: 0,
    axialTilt: 23.44,
    description: 'Earth is the only known planet with life and liquid water on its surface.',
    facts: ['70% water surface', 'One natural satellite (Moon)', 'Magnetic field protects from solar wind']
  },
  mars: {
    name: 'Mars',
    type: 'planet',
    radius: 0.53,
    realRadius: 3389.5,
    color: 0xc1440e,
    orbitalRadius: 24,
    realOrbitalRadius: 227939366,
    orbitalPeriod: 687,
    rotationPeriod: 24.6,
    inclination: 1.85,
    axialTilt: 25.19,
    description: 'Mars is the "Red Planet" with the largest volcano and canyon in the Solar System.',
    facts: ['Two moons: Phobos & Deimos', 'Olympus Mons: tallest mountain', 'Valles Marineris: largest canyon']
  },
  jupiter: {
    name: 'Jupiter',
    type: 'planet',
    radius: 2.5,
    realRadius: 69911,
    color: 0xd8ca9d,
    orbitalRadius: 38,
    realOrbitalRadius: 778340821,
    orbitalPeriod: 4333,
    rotationPeriod: 9.93,
    inclination: 1.3,
    axialTilt: 3.13,
    description: 'Jupiter is the largest planet with a famous Great Red Spot storm.',
    facts: ['95 known moons', 'Great Red Spot: 400+ year storm', 'Strongest magnetic field']
  },
  saturn: {
    name: 'Saturn',
    type: 'planet',
    radius: 2.1,
    realRadius: 58232,
    color: 0xead6b8,
    orbitalRadius: 52,
    realOrbitalRadius: 1426666422,
    orbitalPeriod: 10759,
    rotationPeriod: 10.7,
    inclination: 2.49,
    axialTilt: 26.73,
    description: 'Saturn is famous for its spectacular ring system made of ice and rock.',
    facts: ['146 known moons', 'Rings span 282,000 km', 'Least dense planet (would float in water)']
  },
  uranus: {
    name: 'Uranus',
    type: 'planet',
    radius: 1.6,
    realRadius: 25362,
    color: 0xd1e7e7,
    orbitalRadius: 68,
    realOrbitalRadius: 2870658186,
    orbitalPeriod: 30687,
    rotationPeriod: -17.2,
    inclination: 0.77,
    axialTilt: 97.77,
    description: 'Uranus rotates on its side with an extreme axial tilt of 97.77 degrees.',
    facts: ['Rotates on its side', 'Ice giant (methane ice)', '27 known moons']
  },
  neptune: {
    name: 'Neptune',
    type: 'planet',
    radius: 1.55,
    realRadius: 24622,
    color: 0x5b5ddf,
    orbitalRadius: 82,
    realOrbitalRadius: 4498396441,
    orbitalPeriod: 60190,
    rotationPeriod: 16.1,
    inclination: 1.77,
    axialTilt: 28.32,
    description: 'Neptune is the windiest planet with supersonic winds up to 2,100 km/h.',
    facts: ['16 known moons', 'Winds up to 2,100 km/h', 'Discovered by mathematics before observation']
  }
};

const MOONS: Record<string, CelestialBody> = {
  // Earth's Moon
  moon: {
    name: 'Moon',
    type: 'moon',
    radius: 0.27,
    realRadius: 1737.4,
    color: 0xcccccc,
    orbitalRadius: 2.5,
    realOrbitalRadius: 384400,
    orbitalPeriod: 27.3,
    rotationPeriod: 655.7,
    inclination: 5.14,
    axialTilt: 6.68,
    description: 'Earth\'s only natural satellite, the fifth largest moon in the Solar System.',
    facts: ['Tidally locked to Earth', 'Only moon walked on by humans', 'Causes tides on Earth'],
    parentBody: 'earth'
  },
  // Mars moons
  phobos: {
    name: 'Phobos',
    type: 'moon',
    radius: 0.12,
    realRadius: 11.1,
    color: 0x8b7355,
    orbitalRadius: 1.2,
    realOrbitalRadius: 9376,
    orbitalPeriod: 0.32,
    rotationPeriod: 7.66,
    inclination: 1.08,
    axialTilt: 0,
    description: 'Mars\' larger moon, slowly spiraling inward.',
    facts: ['Will crash into Mars in ~50 million years', 'Orbits faster than Mars rotates'],
    parentBody: 'mars'
  },
  deimos: {
    name: 'Deimos',
    type: 'moon',
    radius: 0.08,
    realRadius: 6.2,
    color: 0x9b8b7a,
    orbitalRadius: 1.8,
    realOrbitalRadius: 23458,
    orbitalPeriod: 1.26,
    rotationPeriod: 30.3,
    inclination: 1.79,
    axialTilt: 0,
    description: 'Mars\' smaller, outer moon.',
    facts: ['Named after Greek god of terror', 'Smallest known moon in Solar System'],
    parentBody: 'mars'
  },
  // Jupiter's Galilean moons
  io: {
    name: 'Io',
    type: 'moon',
    radius: 0.29,
    realRadius: 1821.6,
    color: 0xffee88,
    orbitalRadius: 2.2,
    realOrbitalRadius: 421700,
    orbitalPeriod: 1.77,
    rotationPeriod: 42.5,
    inclination: 0.04,
    axialTilt: 0,
    description: 'The most volcanically active body in the Solar System.',
    facts: ['Over 400 active volcanoes', 'Surface covered in sulfur', 'Tidal heating from Jupiter'],
    parentBody: 'jupiter'
  },
  europa: {
    name: 'Europa',
    type: 'moon',
    radius: 0.25,
    realRadius: 1560.8,
    color: 0xccddee,
    orbitalRadius: 2.8,
    realOrbitalRadius: 670900,
    orbitalPeriod: 3.55,
    rotationPeriod: 85.2,
    inclination: 0.47,
    axialTilt: 0.1,
    description: 'May harbor life in its subsurface ocean beneath an ice shell.',
    facts: ['Ice shell over liquid ocean', 'Prime target for life search', 'Smoothest surface in Solar System'],
    parentBody: 'jupiter'
  },
  ganymede: {
    name: 'Ganymede',
    type: 'moon',
    radius: 0.42,
    realRadius: 2634.1,
    color: 0xaabbcc,
    orbitalRadius: 3.6,
    realOrbitalRadius: 1070400,
    orbitalPeriod: 7.15,
    rotationPeriod: 171.7,
    inclination: 0.18,
    axialTilt: 0.33,
    description: 'The largest moon in the Solar System, larger than Mercury.',
    facts: ['Larger than Mercury', 'Has its own magnetic field', 'Subsurface ocean likely'],
    parentBody: 'jupiter'
  },
  callisto: {
    name: 'Callisto',
    type: 'moon',
    radius: 0.38,
    realRadius: 2410.3,
    color: 0x887766,
    orbitalRadius: 4.4,
    realOrbitalRadius: 1882700,
    orbitalPeriod: 16.69,
    rotationPeriod: 400.5,
    inclination: 0.19,
    axialTilt: 0,
    description: 'Most heavily cratered object in the Solar System.',
    facts: ['Ancient, geologically dead surface', 'May have subsurface ocean', 'Outside Jupiter\'s radiation belt'],
    parentBody: 'jupiter'
  },
  // Saturn's major moons
  titan: {
    name: 'Titan',
    type: 'moon',
    radius: 0.41,
    realRadius: 2574.7,
    color: 0xddaa66,
    orbitalRadius: 3.8,
    realOrbitalRadius: 1221870,
    orbitalPeriod: 15.95,
    rotationPeriod: 382.7,
    inclination: 0.35,
    axialTilt: 0,
    description: 'The only moon with a dense atmosphere, with methane lakes.',
    facts: ['Thicker atmosphere than Earth', 'Methane lakes and rivers', 'Rain of liquid methane'],
    parentBody: 'saturn'
  },
  enceladus: {
    name: 'Enceladus',
    type: 'moon',
    radius: 0.15,
    realRadius: 252.1,
    color: 0xffffff,
    orbitalRadius: 2.2,
    realOrbitalRadius: 238020,
    orbitalPeriod: 1.37,
    rotationPeriod: 32.9,
    inclination: 0,
    axialTilt: 0,
    description: 'Sprays water geysers into space from a subsurface ocean.',
    facts: ['Water ice geysers', 'Subsurface ocean', 'Brightest object in Solar System'],
    parentBody: 'saturn'
  },
  mimas: {
    name: 'Mimas',
    type: 'moon',
    radius: 0.1,
    realRadius: 198.2,
    color: 0xcccccc,
    orbitalRadius: 1.6,
    realOrbitalRadius: 185520,
    orbitalPeriod: 0.94,
    rotationPeriod: 22.6,
    inclination: 1.53,
    axialTilt: 0,
    description: 'Known as the "Death Star" moon due to its large Herschel crater.',
    facts: ['Looks like Death Star', 'Herschel crater is 1/3 moon diameter'],
    parentBody: 'saturn'
  },
  tethys: {
    name: 'Tethys',
    type: 'moon',
    radius: 0.17,
    realRadius: 531.1,
    color: 0xeeeeee,
    orbitalRadius: 2.6,
    realOrbitalRadius: 294619,
    orbitalPeriod: 1.89,
    rotationPeriod: 45.3,
    inclination: 1.12,
    axialTilt: 0,
    description: 'An icy moon with a massive canyon and large crater.',
    facts: ['Ithaca Chasma canyon stretches 3/4 around moon', 'Almost pure water ice'],
    parentBody: 'saturn'
  },
  dione: {
    name: 'Dione',
    type: 'moon',
    radius: 0.18,
    realRadius: 561.4,
    color: 0xdddddd,
    orbitalRadius: 3.0,
    realOrbitalRadius: 377396,
    orbitalPeriod: 2.74,
    rotationPeriod: 65.7,
    inclination: 0.02,
    axialTilt: 0,
    description: 'An icy moon with bright ice cliffs.',
    facts: ['Ice cliffs hundreds of meters high', 'Wispy terrain of ice'],
    parentBody: 'saturn'
  },
  rhea: {
    name: 'Rhea',
    type: 'moon',
    radius: 0.24,
    realRadius: 763.8,
    color: 0xcccccc,
    orbitalRadius: 3.4,
    realOrbitalRadius: 527108,
    orbitalPeriod: 4.52,
    rotationPeriod: 108.4,
    inclination: 0.35,
    axialTilt: 0,
    description: 'Saturn\'s second-largest moon.',
    facts: ['May have thin ring system', 'Heavily cratered'],
    parentBody: 'saturn'
  },
  iapetus: {
    name: 'Iapetus',
    type: 'moon',
    radius: 0.23,
    realRadius: 734.5,
    color: 0x886644,
    orbitalRadius: 4.6,
    realOrbitalRadius: 3560820,
    orbitalPeriod: 79.32,
    rotationPeriod: 1903.9,
    inclination: 15.47,
    axialTilt: 0,
    description: 'A two-toned moon with one bright and one dark hemisphere.',
    facts: ['Two-toned coloring', 'Equatorial ridge up to 20 km high'],
    parentBody: 'saturn'
  },
  // Uranus moons
  miranda: {
    name: 'Miranda',
    type: 'moon',
    radius: 0.1,
    realRadius: 235.8,
    color: 0xaabbcc,
    orbitalRadius: 1.4,
    realOrbitalRadius: 129390,
    orbitalPeriod: 1.41,
    rotationPeriod: 33.9,
    inclination: 4.34,
    axialTilt: 0,
    description: 'The most geologically diverse moon with extreme terrain.',
    facts: ['Verona Rupes: 20 km high cliff', 'Patchwork of different terrains'],
    parentBody: 'uranus'
  },
  ariel: {
    name: 'Ariel',
    type: 'moon',
    radius: 0.18,
    realRadius: 578.9,
    color: 0xbbccdd,
    orbitalRadius: 1.8,
    realOrbitalRadius: 190900,
    orbitalPeriod: 2.52,
    rotationPeriod: 60.5,
    inclination: 0.04,
    axialTilt: 0,
    description: 'The brightest of Uranus\' moons.',
    facts: ['Youngest surface of Uranian moons', 'Many canyons and valleys'],
    parentBody: 'uranus'
  },
  umbriel: {
    name: 'Umbriel',
    type: 'moon',
    radius: 0.18,
    realRadius: 584.7,
    color: 0x777788,
    orbitalRadius: 2.2,
    realOrbitalRadius: 266000,
    orbitalPeriod: 4.14,
    rotationPeriod: 99.5,
    inclination: 0.13,
    axialTilt: 0,
    description: 'The darkest of Uranus\' major moons.',
    facts: ['Darkest of Uranian moons', 'Ancient, heavily cratered surface'],
    parentBody: 'uranus'
  },
  titania: {
    name: 'Titania',
    type: 'moon',
    radius: 0.25,
    realRadius: 788.4,
    color: 0xaabbbb,
    orbitalRadius: 2.8,
    realOrbitalRadius: 435910,
    orbitalPeriod: 8.71,
    rotationPeriod: 209.0,
    inclination: 0.08,
    axialTilt: 0,
    description: 'The largest moon of Uranus.',
    facts: ['Largest Uranian moon', 'Huge canyons up to 1,500 km long'],
    parentBody: 'uranus'
  },
  oberon: {
    name: 'Oberon',
    type: 'moon',
    radius: 0.24,
    realRadius: 761.4,
    color: 0x998877,
    orbitalRadius: 3.4,
    realOrbitalRadius: 583520,
    orbitalPeriod: 13.46,
    rotationPeriod: 323.1,
    inclination: 0.07,
    axialTilt: 0,
    description: 'The outermost major moon of Uranus.',
    facts: ['Second largest Uranian moon', 'Dark floor craters suggest cryovolcanism'],
    parentBody: 'uranus'
  },
  // Neptune moons
  triton: {
    name: 'Triton',
    type: 'moon',
    radius: 0.21,
    realRadius: 1353.4,
    color: 0xddccbb,
    orbitalRadius: 2.8,
    realOrbitalRadius: 354800,
    orbitalPeriod: -5.88,
    rotationPeriod: 141.0,
    inclination: 156.89,
    axialTilt: 0,
    description: 'A captured dwarf planet that orbits Neptune retrograde.',
    facts: ['Only large retrograde moon', 'Nitrogen geysers', 'Captured from Kuiper Belt'],
    parentBody: 'neptune'
  },
  nereid: {
    name: 'Nereid',
    type: 'moon',
    radius: 0.08,
    realRadius: 170,
    color: 0xaabbaa,
    orbitalRadius: 4.0,
    realOrbitalRadius: 5513400,
    orbitalPeriod: 360.14,
    rotationPeriod: 11.52,
    inclination: 7.23,
    axialTilt: 0,
    description: 'Neptune\'s third-largest moon with a highly eccentric orbit.',
    facts: ['Most eccentric orbit of any moon', 'May be a captured object'],
    parentBody: 'neptune'
  }
};

function SolarSystemWindow(): JSX.Element {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationIdRef = useRef<number>(0);
  const sunRef = useRef<THREE.Mesh | null>(null);
  const planetsRef = useRef<Map<string, PlanetData>>(new Map());
  const labelsRef = useRef<Map<string, THREE.Sprite>>(new Map());
  const clockRef = useRef(new THREE.Clock());
  const elapsedTimeRef = useRef<number>(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // State
  const [timeScale, setTimeScale] = useState<number>(4);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [selectedBody, setSelectedBody] = useState<CelestialBody | null>(null);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  const createOrbitLine = useCallback((
    radius: number,
    inclination: number,
    color: number = COLORS.orbitLine,
    dotted: boolean = false
  ): THREE.Line => {
    const segments = 128;
    const points = Array.from({ length: segments + 1 }, (_, i) => {
      const theta = (i / segments) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
    });

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = dotted
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.3, dashSize: 0.3, gapSize: 0.2 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });

    const line = new THREE.Line(geometry, material);
    if (dotted) line.computeLineDistances();
    line.rotation.x = THREE.MathUtils.degToRad(inclination);
    return line;
  }, []);

  const createLabel = useCallback((text: string): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.beginPath();
    context.roundRect(0, 0, 256, 64, 8);
    context.fill();

    context.font = 'bold 28px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    return sprite;
  }, []);

  const createStarfield = useCallback((scene: THREE.Scene) => {
    const starCount = 5000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 600 + Math.random() * 200;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const colorChoice = Math.random();
      if (colorChoice < 0.7) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
      } else if (colorChoice < 0.85) {
        colors[i * 3] = 0.8; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1;
      } else if (colorChoice < 0.95) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.8;
      } else {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.7;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.8,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9
    });

    const stars = new THREE.Points(geometry, material);
    stars.name = 'starfield';
    scene.add(stars);
  }, []);

  const createSun = useCallback((scene: THREE.Scene) => {
    const sunData = CELESTIAL_BODIES.sun;
    const { radius, color, name } = sunData;

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 64, 64),
      new THREE.MeshBasicMaterial({ color })
    );
    sun.name = 'sun';
    sun.userData = { body: sunData };
    scene.add(sun);
    sunRef.current = sun;

    // Sun atmosphere layers
    const createGlowLayer = (scale: number, layerColor: number, opacity: number): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius * scale, 32, 32),
        new THREE.MeshBasicMaterial({ color: layerColor, transparent: true, opacity, side: THREE.BackSide })
      );

    sun.add(createGlowLayer(1.15, COLORS.sunGlow, 0.3));
    sun.add(createGlowLayer(1.4, COLORS.sunCorona, 0.12));
    sun.add(createGlowLayer(1.8, COLORS.sunHalo, 0.05));

    const sunLight = new THREE.PointLight(COLORS.sunLight, 2, 500);
    scene.add(sunLight);

    const label = createLabel(name);
    label.position.set(0, radius + 2, 0);
    sun.add(label);
    labelsRef.current.set('sun', label);
  }, [createLabel]);

  const createSaturnRings = useCallback((saturnGroup: THREE.Group, saturnRadius: number) => {
    const innerRadius = saturnRadius * 1.3;
    const outerRadius = saturnRadius * 2.4;

    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 128, 8);

    // Create procedural ring texture
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 512, 0);
    gradient.addColorStop(0, 'rgba(200,180,160,0.0)');
    gradient.addColorStop(0.08, 'rgba(200,180,160,0.5)');
    gradient.addColorStop(0.18, 'rgba(180,160,140,0.4)');
    gradient.addColorStop(0.22, 'rgba(100,80,60,0.05)'); // Cassini Division
    gradient.addColorStop(0.28, 'rgba(100,80,60,0.05)');
    gradient.addColorStop(0.32, 'rgba(200,180,160,0.45)');
    gradient.addColorStop(0.5, 'rgba(220,200,180,0.6)');
    gradient.addColorStop(0.7, 'rgba(180,160,140,0.35)');
    gradient.addColorStop(0.85, 'rgba(160,140,120,0.25)');
    gradient.addColorStop(1, 'rgba(140,120,100,0.0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 8);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });

    const rings = new THREE.Mesh(geometry, material);
    rings.name = 'saturn_rings';
    rings.rotation.x = Math.PI / 2;

    saturnGroup.add(rings);
  }, []);

  const createPlanets = useCallback((scene: THREE.Scene) => {
    PLANET_NAMES.forEach(name => {
      const bodyData = CELESTIAL_BODIES[name];
      if (!bodyData) return;

      const group = new THREE.Group();
      group.name = `${name}_group`;
      scene.add(group);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(bodyData.radius, 48, 48),
        new THREE.MeshPhongMaterial({
          color: bodyData.color,
          shininess: 10,
          emissive: bodyData.color,
          emissiveIntensity: 0.05
        })
      );
      mesh.name = name;
      mesh.userData = { body: bodyData };
      mesh.rotation.z = THREE.MathUtils.degToRad(bodyData.axialTilt);
      group.add(mesh);

      const orbitLine = createOrbitLine(bodyData.orbitalRadius, bodyData.inclination);
      orbitLine.name = `${name}_orbit`;
      scene.add(orbitLine);

      const planetData: PlanetData = {
        body: bodyData,
        mesh,
        group,
        orbitLine,
        currentAngle: Math.random() * Math.PI * 2,
        moons: new Map()
      };
      planetsRef.current.set(name, planetData);

      const label = createLabel(bodyData.name);
      label.position.set(0, bodyData.radius + 1.5, 0);
      mesh.add(label);
      labelsRef.current.set(name, label);

      // Create moons for this planet
      Object.entries(MOONS)
        .filter(([, moon]) => moon.parentBody === name)
        .forEach(([moonName, moonBody]) => {
          const moonMesh = new THREE.Mesh(
            new THREE.SphereGeometry(moonBody.radius, 24, 24),
            new THREE.MeshPhongMaterial({
              color: moonBody.color,
              shininess: 5,
              emissive: moonBody.color,
              emissiveIntensity: 0.03
            })
          );
          moonMesh.name = moonName;
          moonMesh.userData = { body: moonBody };
          group.add(moonMesh);

          const moonOrbitLine = createOrbitLine(moonBody.orbitalRadius, moonBody.inclination, COLORS.moonOrbitLine, true);
          group.add(moonOrbitLine);

          const moonLabel = createLabel(moonBody.name);
          moonLabel.position.set(0, moonBody.radius + 0.5, 0);
          moonLabel.scale.set(2, 0.5, 1);
          moonMesh.add(moonLabel);
          labelsRef.current.set(moonName, moonLabel);

          planetData.moons.set(moonName, {
            body: moonBody,
            mesh: moonMesh,
            orbitLine: moonOrbitLine,
            currentAngle: Math.random() * Math.PI * 2
          });
        });

      if (name === 'saturn') {
        createSaturnRings(group, bodyData.radius);
      }

      const initialAngle = planetData.currentAngle;
      group.position.set(
        Math.cos(initialAngle) * bodyData.orbitalRadius,
        0,
        Math.sin(initialAngle) * bodyData.orbitalRadius
      );
    });
  }, [createOrbitLine, createLabel, createSaturnRings]);

  // Animation update functions
  const updateOrbits = useCallback((delta: number) => {
    planetsRef.current.forEach((planetData) => {
      const { body, group, moons } = planetData;

      if (body.orbitalPeriod > 0) {
        planetData.currentAngle += ((2 * Math.PI) / body.orbitalPeriod) * delta;
        const angle = planetData.currentAngle;
        const inclinationRad = THREE.MathUtils.degToRad(body.inclination);

        group.position.set(
          Math.cos(angle) * body.orbitalRadius,
          Math.sin(angle) * body.orbitalRadius * Math.sin(inclinationRad),
          Math.sin(angle) * body.orbitalRadius
        );
      }

      moons.forEach((moonData) => {
        const moonBody = moonData.body;
        if (moonBody.orbitalPeriod === 0) return;

        const direction = moonBody.orbitalPeriod < 0 ? -1 : 1;
        moonData.currentAngle += ((2 * Math.PI) / Math.abs(moonBody.orbitalPeriod)) * delta * direction;
        const angle = moonData.currentAngle;
        const inclinationRad = THREE.MathUtils.degToRad(moonBody.inclination);

        moonData.mesh.position.set(
          Math.cos(angle) * moonBody.orbitalRadius,
          Math.sin(angle) * moonBody.orbitalRadius * Math.sin(inclinationRad),
          Math.sin(angle) * moonBody.orbitalRadius
        );
      });
    });
  }, []);

  const updateRotations = useCallback((delta: number) => {
    if (sunRef.current) {
      const rotationSpeed = (2 * Math.PI) / (CELESTIAL_BODIES.sun.rotationPeriod / 24);
      sunRef.current.rotation.y += rotationSpeed * delta * 0.05;
    }

    planetsRef.current.forEach(({ body, mesh }) => {
      if (body.rotationPeriod === 0) return;
      const direction = body.rotationPeriod < 0 ? -1 : 1;
      const rotationSpeed = (2 * Math.PI) / (Math.abs(body.rotationPeriod) / 24);
      mesh.rotation.y += rotationSpeed * delta * direction * 0.3;
    });
  }, []);

  const updateLabelVisibility = useCallback(() => {
    labelsRef.current.forEach((label) => {
      label.visible = showLabels;
    });
  }, [showLabels]);

  const updateOrbitVisibility = useCallback(() => {
    if (!sceneRef.current) return;

    sceneRef.current.traverse((obj) => {
      if ((obj.name.endsWith('_orbit') || obj instanceof THREE.Line) && obj.name !== 'starfield') {
        obj.visible = showOrbits;
      }
    });

    planetsRef.current.forEach((planetData) => {
      planetData.moons.forEach((moonData) => {
        moonData.orbitLine.visible = showOrbits;
      });
    });
  }, [showOrbits]);

  // Interaction handlers
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    const clickables: THREE.Mesh[] = [];
    if (sunRef.current) clickables.push(sunRef.current);
    planetsRef.current.forEach(p => {
      clickables.push(p.mesh);
      p.moons.forEach(m => clickables.push(m.mesh));
    });

    const intersects = raycasterRef.current.intersectObjects(clickables);

    if (intersects.length > 0) {
      const clicked = intersects[0].object as THREE.Mesh;
      const body = clicked.userData.body as CelestialBody;
      setSelectedBody(body);
      focusOnBody(clicked.name);
    }
  }, []);

  const getBodyInfo = useCallback((bodyName: string): { position: THREE.Vector3; radius: number; data: CelestialBody } | null => {
    if (bodyName === 'sun') {
      return { position: new THREE.Vector3(0, 0, 0), radius: CELESTIAL_BODIES.sun.radius, data: CELESTIAL_BODIES.sun };
    }

    if (CELESTIAL_BODIES[bodyName]) {
      const planetData = planetsRef.current.get(bodyName);
      if (planetData) {
        return { position: planetData.group.position.clone(), radius: planetData.body.radius, data: planetData.body };
      }
      return { position: new THREE.Vector3(0, 0, 0), radius: CELESTIAL_BODIES[bodyName].radius, data: CELESTIAL_BODIES[bodyName] };
    }

    if (MOONS[bodyName]) {
      for (const [, pd] of planetsRef.current) {
        const moonData = pd.moons.get(bodyName);
        if (moonData) {
          const position = new THREE.Vector3();
          moonData.mesh.getWorldPosition(position);
          return { position, radius: moonData.body.radius, data: moonData.body };
        }
      }
      return { position: new THREE.Vector3(0, 0, 0), radius: MOONS[bodyName].radius, data: MOONS[bodyName] };
    }

    return null;
  }, []);

  const focusOnBody = useCallback((bodyName: string | null) => {
    if (!bodyName || !cameraRef.current || !controlsRef.current) {
      setFocusTarget(null);
      setSelectedBody(null);
      return;
    }

    const info = getBodyInfo(bodyName);
    if (!info) return;

    setFocusTarget(bodyName);
    setSelectedBody(info.data);

    const cameraDistance = Math.max(info.radius * 8, 5);
    const cameraPosition = info.position.clone().add(
      new THREE.Vector3(cameraDistance * 0.7, cameraDistance * 0.4, cameraDistance * 0.7)
    );

    controlsRef.current.target.copy(info.position);
    cameraRef.current.position.copy(cameraPosition);
    controlsRef.current.update();
  }, [getBodyInfo]);

  // Scene initialization
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sceneBackground);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(30, 40, 80);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 400;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0x222233, 0.4));
    createStarfield(scene);
    createSun(scene);
    createPlanets(scene);

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      if (isPaused) {
        clockRef.current.getDelta();
      } else {
        const delta = clockRef.current.getDelta() * timeScale;
        elapsedTimeRef.current += delta;
        updateOrbits(delta);
        updateRotations(delta);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationIdRef.current);
      resizeObserver.disconnect();
      renderer.dispose();
      controls.dispose();
    };
  }, [createStarfield, createSun, createPlanets, updateOrbits, updateRotations, isPaused, timeScale]);

  useEffect(() => {
    updateLabelVisibility();
  }, [showLabels, updateLabelVisibility]);

  useEffect(() => {
    updateOrbitVisibility();
  }, [showOrbits, updateOrbitVisibility]);

  // Format display values for the info panel
  const formatOrbitalPeriod = (days: number): string => {
    if (days < 365) return `${days.toFixed(1)} days`;
    return `${(days / 365.25).toFixed(1)} years`;
  };

  const formatRotationPeriod = (hours: number): string => {
    const absHours = Math.abs(hours);
    const suffix = hours < 0 ? ' (retrograde)' : '';
    if (absHours < 48) return `${absHours.toFixed(1)} hours${suffix}`;
    return `${(absHours / 24).toFixed(1)} days${suffix}`;
  };

  const getButtonRingClass = (bodyName: string, ringColor: 'orange' | 'blue'): string => {
    if (focusTarget !== bodyName) return '';
    return `ring-2 ring-${ringColor}-500 ring-offset-2 ring-offset-slate-900`;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-950 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onClick={handleCanvasClick}
      />

      {/* Control Panel */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-4 w-64 text-white">
        <h2 className="text-lg font-bold mb-3 text-orange-400">Solar System</h2>

        {/* Time Controls */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">
            Time Scale
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                isPaused ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'
              } text-white transition-colors`}
            >
              {isPaused ? 'Play' : 'Pause'}
            </button>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={timeScale}
              onChange={(e) => setTimeScale(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-slate-300 w-12 text-right">{timeScale.toFixed(1)}x</span>
          </div>
        </div>

        {/* View Options */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-2 block">
            View Options
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                className="rounded bg-slate-700 border-slate-600"
              />
              Show Labels
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showOrbits}
                onChange={(e) => setShowOrbits(e.target.checked)}
                className="rounded bg-slate-700 border-slate-600"
              />
              Show Orbits
            </label>
          </div>
        </div>

        {/* Focus Target */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-2 block">
            Focus On
          </label>
          <select
            value={focusTarget || ''}
            onChange={(e) => focusOnBody(e.target.value || null)}
            className="w-full bg-slate-800 text-white rounded px-3 py-2 text-sm border border-slate-700 focus:border-orange-500 focus:outline-none"
          >
            <option value="">Free Camera</option>
            <option value="sun">Sun</option>
            <optgroup label="Planets">
              {PLANET_NAMES.map(name => (
                <option key={name} value={name}>{CELESTIAL_BODIES[name].name}</option>
              ))}
            </optgroup>
            <optgroup label="Moons">
              {Object.keys(MOONS).map(name => (
                <option key={name} value={name}>
                  {MOONS[name].name} ({MOONS[name].parentBody})
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Planet Quick Select */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 bg-slate-900/80 backdrop-blur-sm rounded-lg p-2 flex flex-col gap-1">
        <button
          onClick={() => focusOnBody('sun')}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all hover:scale-110 ${getButtonRingClass('sun', 'orange')}`}
          style={{ backgroundColor: '#ffdd33' }}
          title="Sun"
        >
          *
        </button>
        {PLANET_NAMES.map(name => {
          const body = CELESTIAL_BODIES[name];
          return (
            <button
              key={name}
              onClick={() => focusOnBody(name)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 ${getButtonRingClass(name, 'blue')}`}
              style={{
                backgroundColor: `#${body.color.toString(16).padStart(6, '0')}`,
                transform: `scale(${0.6 + (body.radius / 3) * 0.4})`
              }}
              title={body.name}
            />
          );
        })}
      </div>

      {/* Info Panel */}
      {selectedBody && (
        <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-4 w-80 text-white">
          <div className="flex justify-between items-start mb-3">
            <h3 className="text-xl font-bold text-orange-400">{selectedBody.name}</h3>
            <button
              onClick={() => setSelectedBody(null)}
              className="text-slate-400 hover:text-white text-xl leading-none"
            >
              x
            </button>
          </div>

          <p className="text-sm text-slate-300 mb-4">{selectedBody.description}</p>

          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Type:</span>
              <span className="text-slate-200 capitalize">{selectedBody.type}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Radius:</span>
              <span className="text-slate-200">{selectedBody.realRadius.toLocaleString()} km</span>
            </div>
            {selectedBody.orbitalPeriod > 0 && (
              <div className="flex justify-between border-b border-slate-700 pb-1">
                <span className="text-slate-400">Orbital Period:</span>
                <span className="text-slate-200">{formatOrbitalPeriod(selectedBody.orbitalPeriod)}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Rotation Period:</span>
              <span className="text-slate-200">{formatRotationPeriod(selectedBody.rotationPeriod)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Axial Tilt:</span>
              <span className="text-slate-200">{selectedBody.axialTilt.toFixed(1)}deg</span>
            </div>
          </div>

          {selectedBody.facts.length > 0 && (
            <div className="pt-3 border-t border-slate-700">
              <span className="text-xs text-slate-400 uppercase tracking-wider">Fun Facts</span>
              <ul className="mt-2 space-y-1">
                {selectedBody.facts.map((fact, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                    <span className="text-orange-400">*</span>
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-sm rounded-lg px-4 py-2 text-slate-400 text-sm">
        Click on any celestial body to select | Drag to orbit | Scroll to zoom
      </div>
    </div>
  );
}

SolarSystemWindow;
