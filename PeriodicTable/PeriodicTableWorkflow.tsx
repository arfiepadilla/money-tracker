// PeriodicTableWorkflow - Interactive Periodic Table with 3D Atom Visualization
// Note: React, useState, useEffect, useRef, useCallback, useMemo, THREE, OrbitControls are provided by DynamicModuleLoader

// Type definitions (inline since we can't use ES imports in dynamic modules)
interface ElementData {
    number: number;
    symbol: string;
    name: string;
    mass: number;
    category: string;
    xpos: number;
    ypos: number;
    summary: string;
    electronConfig?: string;
    abundance?: string;
    discoveryYear?: number;
    meltingPoint?: number;
    boilingPoint?: number;
    funFact?: string;
    electronegativity?: number;
    valenceElectrons?: number;
}

// ================= MOLECULE BUILDER TYPES =================

type HybridizationState = 'sp' | 'sp2' | 'sp3' | 'sp3d' | 'sp3d2' | 'none';
type BondType = 'single' | 'double' | 'triple' | 'ionic' | 'metallic' | 'hydrogen';
type VSEPRGeometry =
    | 'linear'
    | 'bent'
    | 'trigonal-planar'
    | 'trigonal-pyramidal'
    | 'tetrahedral'
    | 'see-saw'
    | 'square-planar'
    | 'trigonal-bipyramidal'
    | 'square-pyramidal'
    | 'octahedral'
    | 't-shaped';
type CrystalSystem = 'cubic' | 'tetragonal' | 'orthorhombic' | 'hexagonal' | 'trigonal' | 'monoclinic' | 'triclinic';
type BuilderMode = 'select' | 'add' | 'bond' | 'move';

interface Position3D {
    x: number;
    y: number;
    z: number;
}

interface MoleculeAtom {
    id: string;
    elementNumber: number;
    position: Position3D;
    hybridization: HybridizationState;
    formalCharge: number;
    lonePairs: number;
    bondedAtomIds: string[];
    label?: string;
}

interface MoleculeBond {
    id: string;
    atom1Id: string;
    atom2Id: string;
    type: BondType;
    order: number;
    polarity: number;
    polarDirection: 1 | -1 | 0;
    length?: number;
}

interface MoleculeMetadata {
    name: string;
    formula: string;
    molecularMass: number;
    createdAt: string;
    modifiedAt: string;
    description?: string;
    source?: 'user' | 'ai' | 'preset' | 'file';
}

interface Molecule {
    atoms: MoleculeAtom[];
    bonds: MoleculeBond[];
    metadata: MoleculeMetadata;
    centerOfMass: Position3D;
}

interface CrystalLatticeParams {
    a: number;
    b: number;
    c: number;
    alpha: number;
    beta: number;
    gamma: number;
}

interface CrystalLattice {
    system: CrystalSystem;
    params: CrystalLatticeParams;
    motifAtoms: MoleculeAtom[];
    tiling: { nx: number; ny: number; nz: number };
}

interface MoleculeFile {
    version: '1.0.0';
    type: 'molecule' | 'crystal';
    molecule?: Molecule;
    crystal?: CrystalLattice;
    viewState?: {
        cameraPosition: Position3D;
        cameraTarget: Position3D;
    };
}

interface MoleculeViewer3DProps {
    molecule: Molecule;
    crystal: CrystalLattice | null;
    elements: ElementData[];
    selectedAtomId: string | null;
    selectedBondId: string | null;
    builderMode: BuilderMode;
    selectedElement: ElementData | null;
    bondTypeToCreate: BondType;
    showUnitCell: boolean;
    showElectrons: boolean;
    onAtomSelect: (atomId: string | null) => void;
    onBondSelect: (bondId: string | null) => void;
    onAtomAdd: (position: Position3D) => void;
    onAtomMove: (atomId: string, position: Position3D) => void;
    onBondCreate: (atom1Id: string, atom2Id: string) => void;
}

// ================= 3D COMPONENT =================

type VisualizationMode = 'bohr' | 'orbital';

interface OrbitalVisibility {
    s: boolean;
    p: boolean;
    d: boolean;
    f: boolean;
}

interface AtomViewerProps {
    element: ElementData;
    electronsLocked: boolean;
    visualizationMode: VisualizationMode;
    orbitalVisibility?: OrbitalVisibility;
}

const AtomViewer: React.FC<AtomViewerProps> = ({ element, electronsLocked, visualizationMode, orbitalVisibility = { s: true, p: true, d: true, f: true } }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const animationIdRef = useRef<number>(0);
    const electronsRef = useRef<THREE.Group | null>(null);
    const orbitalCloudRef = useRef<THREE.Group | null>(null);
    const electronsLockedRef = useRef(electronsLocked);

    // Keep ref in sync with prop
    useEffect(() => {
        electronsLockedRef.current = electronsLocked;
    }, [electronsLocked]);

    // Initialize Scene
    useEffect(() => {
        if (!containerRef.current || !canvasRef.current) {
            console.error("AtomViewer: Container or canvas ref is null");
            return;
        }

        const container = containerRef.current;
        const canvas = canvasRef.current;

        console.log("AtomViewer: Initializing Three.js scene...", container.clientWidth, container.clientHeight);

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0e1a); // Deep dark blue-black
        scene.fog = new THREE.FogExp2(0x0a0e1a, 0.012);
        sceneRef.current = scene;

        // Camera - zoomed out more by default
        const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 200);
        camera.position.set(0, 0, 25); // Zoomed out from 15 to 25
        cameraRef.current = camera;

        // Renderer with enhanced settings - pass canvas explicitly
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        rendererRef.current = renderer;

        // Controls - adjusted distances
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.5;
        controls.minDistance = 8;  // Increased from 5
        controls.maxDistance = 60; // Increased from 30
        controlsRef.current = controls;

        // Enhanced Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const mainLight = new THREE.PointLight(0xffffff, 1.5);
        mainLight.position.set(10, 10, 10);
        scene.add(mainLight);

        const accentLight1 = new THREE.PointLight(0x00ffff, 1.2);
        accentLight1.position.set(-10, 5, -5);
        scene.add(accentLight1);

        const accentLight2 = new THREE.PointLight(0xff00ff, 1.0);
        accentLight2.position.set(5, -10, 5);
        scene.add(accentLight2);

        // Rim light for depth
        const rimLight = new THREE.SpotLight(0x4488ff, 0.8);
        rimLight.position.set(0, 0, -15);
        scene.add(rimLight);

        // Initial Nucleus (will be updated)
        const nucleusGeo = new THREE.SphereGeometry(1.5, 64, 64);
        const nucleusMat = new THREE.MeshPhysicalMaterial({
            color: 0xffaa00,
            roughness: 0.2,
            metalness: 0.9,
            emissive: 0xff4400,
            emissiveIntensity: 0.4,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
        });
        const nucleus = new THREE.Mesh(nucleusGeo, nucleusMat);
        nucleus.name = "nucleus";
        scene.add(nucleus);

        // Add glow effect to nucleus
        const glowGeo = new THREE.SphereGeometry(1.8, 64, 64);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.3,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.name = "glow";
        scene.add(glow);

        // Electron Group (Bohr model)
        const electronGroup = new THREE.Group();
        electronGroup.name = "bohrElectrons";
        scene.add(electronGroup);
        electronsRef.current = electronGroup;

        // Orbital Cloud Group (probability density)
        const orbitalGroup = new THREE.Group();
        orbitalGroup.name = "orbitalCloud";
        scene.add(orbitalGroup);
        orbitalCloudRef.current = orbitalGroup;

        // Animation Loop
        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);

            // Rotate nucleus glow
            const nucleusObj = scene.getObjectByName("nucleus");
            const glowObj = scene.getObjectByName("glow");
            if (nucleusObj) {
                nucleusObj.rotation.y += 0.005;
                nucleusObj.rotation.x += 0.003;
            }
            if (glowObj) {
                glowObj.rotation.y -= 0.003;
                glowObj.rotation.x -= 0.002;
            }

            // Animate electrons only if not locked
            if (electronsRef.current && !electronsLockedRef.current) {
                electronsRef.current.children.forEach((child) => {
                    const speed = child.userData.speed || 1;
                    const axis = child.userData.axis || new THREE.Vector3(0, 1, 0);
                    child.rotateOnAxis(axis, speed * 0.015);
                });
            }

            // Animate orbital clouds with subtle rotation
            if (orbitalCloudRef.current && !electronsLockedRef.current) {
                orbitalCloudRef.current.rotation.y += 0.002;
            }

            controls.update();
            renderer.render(scene, camera);
        };
        animate();
        console.log("AtomViewer: Animation loop started");

        // Responsive Handling
        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;

            if (width === 0 || height === 0) return;

            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(containerRef.current);

        // Trigger initial resize to ensure size is correct if container was initially hidden or small
        setTimeout(handleResize, 100);

        return () => {
            console.log("AtomViewer: Cleaning up...");
            resizeObserver.disconnect();
            cancelAnimationFrame(animationIdRef.current);
            if (rendererRef.current) {
                rendererRef.current.dispose();
            }
        };
    }, []);

    // Update Atom on Element Change or Visualization Mode Change
    useEffect(() => {
        if (!sceneRef.current || !electronsRef.current || !orbitalCloudRef.current || !cameraRef.current) return;

        const scene = sceneRef.current;
        const camera = cameraRef.current;

        // Update Nucleus Color based on element
        const nucleus = scene.getObjectByName("nucleus") as THREE.Mesh;
        const glow = scene.getObjectByName("glow") as THREE.Mesh;
        if (nucleus && glow) {
            // Create vibrant color based on element number
            const hue = (element.number * 0.05) % 1;
            const color = new THREE.Color().setHSL(hue, 0.9, 0.6);
            const emissiveColor = new THREE.Color().setHSL(hue, 1.0, 0.5);

            (nucleus.material as THREE.MeshPhysicalMaterial).color = color;
            (nucleus.material as THREE.MeshPhysicalMaterial).emissive = emissiveColor;
            (nucleus.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.5;

            (glow.material as THREE.MeshBasicMaterial).color = emissiveColor;
        }

        // Clear both visualization groups
        const bohrGroup = electronsRef.current;
        const orbitalGroup = orbitalCloudRef.current;
        bohrGroup.clear();
        orbitalGroup.clear();

        const electronCount = element.number;
        // Shell capacity: 2, 8, 18, 32, etc. (2n^2)
        const shells: { n: number; count: number }[] = [];
        let remaining = electronCount;
        let n = 1;
        while (remaining > 0) {
            const capacity = 2 * n * n;
            const count = Math.min(remaining, capacity);
            shells.push({ n, count });
            remaining -= count;
            n++;
        }

        // Adjust camera based on number of shells
        const idealDistance = 12 + shells.length * 4;
        camera.position.z = idealDistance;

        // Orbit opacity based on lock state
        const orbitOpacity = electronsLocked ? 0.5 : 0.2;

        if (visualizationMode === 'bohr') {
            // Show Bohr model, hide orbital cloud
            bohrGroup.visible = true;
            orbitalGroup.visible = false;

            // Create electron meshes with enhanced visuals
            const electronGeo = new THREE.SphereGeometry(0.2, 32, 32);
            const electronMat = new THREE.MeshPhysicalMaterial({
                color: 0x00ffff,
                emissive: 0x00ffff,
                emissiveIntensity: 0.8,
                roughness: 0.3,
                metalness: 0.7,
            });
            const orbitMat = new THREE.LineBasicMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: orbitOpacity,
            });

            shells.forEach((shell, shellIdx) => {
                const radius = 2.8 + shellIdx * 1.5;

                // Draw Orbit Ring
                const orbitPoints = [];
                for (let i = 0; i <= 128; i++) {
                    const theta = (i / 128) * Math.PI * 2;
                    orbitPoints.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
                }
                const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPoints);
                const orbit = new THREE.Line(orbitGeo, orbitMat.clone());

                // Rotate orbit randomly for Bohr-Sommerfeld look
                const orbitGroup = new THREE.Group();
                orbitGroup.add(orbit);

                // Distribute electrons on this shell
                for (let i = 0; i < shell.count; i++) {
                    const phi = (i / shell.count) * Math.PI * 2;
                    const electron = new THREE.Mesh(electronGeo, electronMat.clone());
                    electron.position.set(Math.cos(phi) * radius, 0, Math.sin(phi) * radius);

                    // Add electron glow
                    const eGlowGeo = new THREE.SphereGeometry(0.35, 16, 16);
                    const eGlowMat = new THREE.MeshBasicMaterial({
                        color: 0x00ffff,
                        transparent: true,
                        opacity: 0.3,
                    });
                    const eGlow = new THREE.Mesh(eGlowGeo, eGlowMat);
                    eGlow.position.copy(electron.position);

                    orbitGroup.add(electron);
                    orbitGroup.add(eGlow);
                }

                // Random rotation for the shell to make it look 3D
                orbitGroup.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                orbitGroup.userData = {
                    speed: 0.8 + Math.random() * 0.8,
                    axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
                };

                bohrGroup.add(orbitGroup);
            });
        } else {
            // Show orbital cloud (probability density), hide Bohr model
            bohrGroup.visible = false;
            orbitalGroup.visible = true;

            // Generate orbital clouds based on electron configuration
            // Simplified: s, p, d, f orbitals
            generateOrbitalCloud(orbitalGroup, element, shells, orbitalVisibility);
        }

    }, [element, visualizationMode, electronsLocked, orbitalVisibility]);

    return (
        <div ref={containerRef} className="w-full h-full min-h-[300px] relative pointer-events-none">
            <canvas ref={canvasRef} className="w-full h-full pointer-events-auto" />
        </div>
    );
};

// Orbital colors matching the reference image
const ORBITAL_COLORS: Record<string, { primary: number; secondary: number }> = {
    s: { primary: 0xff6b6b, secondary: 0xee5a5a }, // Red/pink
    p: { primary: 0xffd93d, secondary: 0xf0a500 }, // Yellow/orange
    d: { primary: 0x6bcbff, secondary: 0x4a9fd4 }, // Blue/cyan
    f: { primary: 0x6bff8a, secondary: 0x4ad45a }, // Green
};

// Create a single lobe (elongated ellipsoid) for p, d, f orbitals
function createLobeMesh(
    radiusX: number,
    radiusY: number,
    radiusZ: number,
    color: number,
    opacity: number
): THREE.Mesh {
    // Use a sphere geometry and scale it to create ellipsoid
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    geometry.scale(radiusX, radiusY, radiusZ);

    const material = new THREE.MeshPhysicalMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        roughness: 0.3,
        metalness: 0.1,
        clearcoat: 0.3,
        clearcoatRoughness: 0.4,
        emissive: color,
        emissiveIntensity: 0.15,
        depthWrite: false,
    });

    return new THREE.Mesh(geometry, material);
}

// Create s orbital - simple sphere
function createSOrbital(radius: number, opacity: number): THREE.Group {
    const group = new THREE.Group();
    const { primary } = ORBITAL_COLORS.s;

    const sphere = createLobeMesh(radius, radius, radius, primary, opacity);
    group.add(sphere);

    return group;
}

// Create p orbital - dumbbell shape (two lobes along an axis)
function createPOrbital(radius: number, axis: 'x' | 'y' | 'z', opacity: number): THREE.Group {
    const group = new THREE.Group();
    const { primary, secondary } = ORBITAL_COLORS.p;

    const lobeLength = radius * 1.2;
    const lobeWidth = radius * 0.5;

    // Positive lobe
    const lobe1 = createLobeMesh(lobeWidth, lobeLength, lobeWidth, primary, opacity);
    // Negative lobe (slightly different color for visual distinction)
    const lobe2 = createLobeMesh(lobeWidth, lobeLength, lobeWidth, secondary, opacity);

    // Position lobes along the specified axis
    const offset = lobeLength * 0.7;
    if (axis === 'x') {
        lobe1.position.x = offset;
        lobe2.position.x = -offset;
        lobe1.rotation.z = Math.PI / 2;
        lobe2.rotation.z = Math.PI / 2;
    } else if (axis === 'y') {
        lobe1.position.y = offset;
        lobe2.position.y = -offset;
    } else {
        lobe1.position.z = offset;
        lobe2.position.z = -offset;
        lobe1.rotation.x = Math.PI / 2;
        lobe2.rotation.x = Math.PI / 2;
    }

    group.add(lobe1);
    group.add(lobe2);

    return group;
}

// Create d orbital - four-lobed cloverleaf or dz2 shape
function createDOrbital(radius: number, type: number, opacity: number): THREE.Group {
    const group = new THREE.Group();
    const { primary, secondary } = ORBITAL_COLORS.d;

    const lobeLength = radius * 0.9;
    const lobeWidth = radius * 0.4;

    if (type === 4) {
        // dz2 - two lobes along z with a torus in xy plane
        const lobe1 = createLobeMesh(lobeWidth * 0.8, lobeLength, lobeWidth * 0.8, primary, opacity);
        const lobe2 = createLobeMesh(lobeWidth * 0.8, lobeLength, lobeWidth * 0.8, primary, opacity);
        lobe1.position.y = lobeLength * 0.7;
        lobe2.position.y = -lobeLength * 0.7;
        group.add(lobe1);
        group.add(lobe2);

        // Torus (donut) around the middle
        const torusGeometry = new THREE.TorusGeometry(radius * 0.5, radius * 0.15, 16, 32);
        const torusMaterial = new THREE.MeshPhysicalMaterial({
            color: secondary,
            transparent: true,
            opacity: opacity * 0.7,
            side: THREE.DoubleSide,
            roughness: 0.3,
            emissive: secondary,
            emissiveIntensity: 0.1,
            depthWrite: false,
        });
        const torus = new THREE.Mesh(torusGeometry, torusMaterial);
        torus.rotation.x = Math.PI / 2;
        group.add(torus);
    } else {
        // Four-lobed cloverleaf pattern
        const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const rotationAxis = type < 2 ? 'z' : (type === 2 ? 'y' : 'x');

        angles.forEach((angle, i) => {
            const lobe = createLobeMesh(lobeWidth, lobeLength * 0.8, lobeWidth, i % 2 === 0 ? primary : secondary, opacity);

            const distance = lobeLength * 0.55;
            if (rotationAxis === 'z') {
                lobe.position.x = Math.cos(angle + (type === 0 ? Math.PI / 4 : 0)) * distance;
                lobe.position.y = Math.sin(angle + (type === 0 ? Math.PI / 4 : 0)) * distance;
                lobe.rotation.z = angle + (type === 0 ? Math.PI / 4 : 0);
            } else if (rotationAxis === 'y') {
                lobe.position.x = Math.cos(angle) * distance;
                lobe.position.z = Math.sin(angle) * distance;
                lobe.rotation.y = -angle;
                lobe.rotation.z = Math.PI / 2;
            } else {
                lobe.position.y = Math.cos(angle) * distance;
                lobe.position.z = Math.sin(angle) * distance;
                lobe.rotation.x = angle;
            }

            group.add(lobe);
        });
    }

    return group;
}

// Create f orbital - complex multi-lobed shape
function createFOrbital(radius: number, type: number, opacity: number): THREE.Group {
    const group = new THREE.Group();
    const { primary, secondary } = ORBITAL_COLORS.f;

    const lobeLength = radius * 0.7;
    const lobeWidth = radius * 0.3;

    // f orbitals have 6-8 lobes in complex arrangements
    const lobeCount = type < 3 ? 6 : 8;
    const baseRotation = (type * Math.PI) / 7;

    for (let i = 0; i < lobeCount; i++) {
        const lobe = createLobeMesh(lobeWidth, lobeLength * 0.7, lobeWidth, i % 2 === 0 ? primary : secondary, opacity);

        const theta = (i / lobeCount) * Math.PI * 2 + baseRotation;
        const phi = (i % 2 === 0) ? Math.PI / 3 : (2 * Math.PI) / 3;

        const distance = lobeLength * 0.5;
        lobe.position.x = Math.sin(phi) * Math.cos(theta) * distance;
        lobe.position.y = Math.cos(phi) * distance * (i % 2 === 0 ? 1 : -1);
        lobe.position.z = Math.sin(phi) * Math.sin(theta) * distance;

        // Orient lobe to point outward from center
        lobe.lookAt(lobe.position.clone().multiplyScalar(2));
        lobe.rotateX(Math.PI / 2);

        group.add(lobe);
    }

    return group;
}

// Generate orbital mesh lobes for visualization
function generateOrbitalCloud(group: THREE.Group, element: ElementData, shells: { n: number; count: number }[], orbitalVisibility: OrbitalVisibility = { s: true, p: true, d: true, f: true }) {
    // Generate orbital meshes for each shell
    shells.forEach((shell, shellIdx) => {
        const baseRadius = 2.5 + shellIdx * 2;

        let electronsRemaining = shell.count;
        const orbitals: { type: string; maxElectrons: number; electrons: number }[] = [];

        // s orbital (always present)
        const sElectrons = Math.min(electronsRemaining, 2);
        if (sElectrons > 0) {
            orbitals.push({ type: 's', maxElectrons: 2, electrons: sElectrons });
            electronsRemaining -= sElectrons;
        }

        // p orbital (for n >= 2)
        if (shell.n >= 2 && electronsRemaining > 0) {
            const pElectrons = Math.min(electronsRemaining, 6);
            orbitals.push({ type: 'p', maxElectrons: 6, electrons: pElectrons });
            electronsRemaining -= pElectrons;
        }

        // d orbital (for n >= 3)
        if (shell.n >= 3 && electronsRemaining > 0) {
            const dElectrons = Math.min(electronsRemaining, 10);
            orbitals.push({ type: 'd', maxElectrons: 10, electrons: dElectrons });
            electronsRemaining -= dElectrons;
        }

        // f orbital (for n >= 4)
        if (shell.n >= 4 && electronsRemaining > 0) {
            const fElectrons = Math.min(electronsRemaining, 14);
            orbitals.push({ type: 'f', maxElectrons: 14, electrons: fElectrons });
        }

        orbitals.forEach((orbital) => {
            // Skip if this orbital type is not visible
            if (!orbitalVisibility[orbital.type as keyof OrbitalVisibility]) {
                return;
            }

            // Calculate opacity based on electron filling
            const fillRatio = orbital.electrons / orbital.maxElectrons;
            const opacity = 0.3 + fillRatio * 0.35;

            switch (orbital.type) {
                case 's': {
                    const sOrbital = createSOrbital(baseRadius * 0.4, opacity);
                    group.add(sOrbital);
                    break;
                }
                case 'p': {
                    // Create px, py, pz based on electron count (2 electrons per orbital)
                    const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
                    const orbitalCount = Math.ceil(orbital.electrons / 2);
                    for (let i = 0; i < orbitalCount; i++) {
                        const pOrbital = createPOrbital(baseRadius * 0.35, axes[i], opacity);
                        group.add(pOrbital);
                    }
                    break;
                }
                case 'd': {
                    // Create d orbitals based on electron count (2 electrons per orbital)
                    const orbitalCount = Math.ceil(orbital.electrons / 2);
                    for (let i = 0; i < orbitalCount; i++) {
                        const dOrbital = createDOrbital(baseRadius * 0.45, i, opacity);
                        group.add(dOrbital);
                    }
                    break;
                }
                case 'f': {
                    // Create f orbitals based on electron count (2 electrons per orbital)
                    const orbitalCount = Math.ceil(orbital.electrons / 2);
                    for (let i = 0; i < orbitalCount; i++) {
                        const fOrbital = createFOrbital(baseRadius * 0.5, i, opacity);
                        group.add(fOrbital);
                    }
                    break;
                }
            }
        });
    });
}

// ================= CHEMISTRY CONSTANTS =================

// Covalent radii in Angstroms (for bond length calculation)
const COVALENT_RADII: Record<number, number> = {
    1: 0.31, 2: 0.28, 3: 1.28, 4: 0.96, 5: 0.84, 6: 0.76, 7: 0.71, 8: 0.66, 9: 0.57, 10: 0.58,
    11: 1.66, 12: 1.41, 13: 1.21, 14: 1.11, 15: 1.07, 16: 1.05, 17: 1.02, 18: 1.06,
    19: 2.03, 20: 1.76, 26: 1.32, 29: 1.32, 30: 1.22, 35: 1.20, 53: 1.39,
};

// Van der Waals radii in Angstroms (for atom sphere sizing)
const VAN_DER_WAALS_RADII: Record<number, number> = {
    1: 1.20, 2: 1.40, 3: 1.82, 4: 1.53, 5: 1.92, 6: 1.70, 7: 1.55, 8: 1.52, 9: 1.47, 10: 1.54,
    11: 2.27, 12: 1.73, 13: 1.84, 14: 2.10, 15: 1.80, 16: 1.80, 17: 1.75, 18: 1.88,
    19: 2.75, 20: 2.31, 26: 2.00, 29: 1.40, 30: 1.39, 35: 1.85, 53: 1.98,
};

// CPK coloring scheme for elements
const ELEMENT_COLORS: Record<number, number> = {
    1: 0xffffff,   // H - white
    2: 0xd9ffff,   // He - cyan
    3: 0xcc80ff,   // Li - violet
    4: 0xc2ff00,   // Be - dark green
    5: 0xffb5b5,   // B - salmon
    6: 0x333333,   // C - dark gray
    7: 0x3050f8,   // N - blue
    8: 0xff0d0d,   // O - red
    9: 0x90e050,   // F - green
    10: 0xb3e3f5,  // Ne - light cyan
    11: 0xab5cf2,  // Na - purple
    12: 0x8aff00,  // Mg - green
    13: 0xbfa6a6,  // Al - gray
    14: 0xf0c8a0,  // Si - tan
    15: 0xff8000,  // P - orange
    16: 0xffff30,  // S - yellow
    17: 0x1ff01f,  // Cl - green
    18: 0x80d1e3,  // Ar - cyan
    19: 0x8f40d4,  // K - purple
    20: 0x3dff00,  // Ca - green
    26: 0xe06633,  // Fe - orange
    29: 0xc88033,  // Cu - copper
    30: 0x7d80b0,  // Zn - gray-blue
    35: 0xa62929,  // Br - dark red
    47: 0xc0c0c0,  // Ag - silver
    53: 0x940094,  // I - purple
    79: 0xffd123,  // Au - gold
};

// Default color for elements not in the map
const DEFAULT_ELEMENT_COLOR = 0xff00ff;

// VSEPR geometry mapping: "bondingPairs-lonePairs" -> geometry
const VSEPR_GEOMETRIES: Record<string, VSEPRGeometry> = {
    '2-0': 'linear',
    '3-0': 'trigonal-planar',
    '2-1': 'bent',
    '4-0': 'tetrahedral',
    '3-1': 'trigonal-pyramidal',
    '2-2': 'bent',
    '5-0': 'trigonal-bipyramidal',
    '4-1': 'see-saw',
    '3-2': 't-shaped',
    '2-3': 'linear',
    '6-0': 'octahedral',
    '5-1': 'square-pyramidal',
    '4-2': 'square-planar',
};

// Ideal bond angles for each hybridization
const HYBRIDIZATION_ANGLES: Record<HybridizationState, number> = {
    'sp': 180,
    'sp2': 120,
    'sp3': 109.5,
    'sp3d': 90,   // Equatorial: 120, Axial: 90
    'sp3d2': 90,
    'none': 0,
};

// Crystal system constraints
const CRYSTAL_SYSTEM_CONSTRAINTS: Record<CrystalSystem, { equalAxes: string[]; angles: Partial<CrystalLatticeParams> }> = {
    'cubic': { equalAxes: ['a', 'b', 'c'], angles: { alpha: 90, beta: 90, gamma: 90 } },
    'tetragonal': { equalAxes: ['a', 'b'], angles: { alpha: 90, beta: 90, gamma: 90 } },
    'orthorhombic': { equalAxes: [], angles: { alpha: 90, beta: 90, gamma: 90 } },
    'hexagonal': { equalAxes: ['a', 'b'], angles: { alpha: 90, beta: 90, gamma: 120 } },
    'trigonal': { equalAxes: ['a', 'b', 'c'], angles: {} }, // Equal angles
    'monoclinic': { equalAxes: [], angles: { alpha: 90, gamma: 90 } },
    'triclinic': { equalAxes: [], angles: {} },
};

// Max valence electrons for common elements
const MAX_VALENCE: Record<number, number> = {
    1: 1, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 3, 8: 2, 9: 1, 10: 0,
    11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 7, 18: 0,
    19: 1, 20: 2, 26: 6, 29: 2, 30: 2, 35: 7, 47: 1, 53: 7, 79: 3,
};

// ================= CHEMISTRY FUNCTIONS =================

function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}

function getMaxValence(elementNumber: number): number {
    return MAX_VALENCE[elementNumber] ?? 4;
}

function calculateCurrentValence(atomId: string, bonds: MoleculeBond[]): number {
    return bonds
        .filter(b => b.atom1Id === atomId || b.atom2Id === atomId)
        .reduce((sum, b) => sum + b.order, 0);
}

function canFormBond(atom: MoleculeAtom, bondOrder: number, bonds: MoleculeBond[]): boolean {
    const currentValence = calculateCurrentValence(atom.id, bonds);
    const maxValence = getMaxValence(atom.elementNumber);
    return (currentValence + bondOrder) <= maxValence;
}

function calculateBondPolarity(
    atom1: MoleculeAtom,
    atom2: MoleculeAtom,
    elements: ElementData[]
): { polarity: number; direction: 1 | -1 | 0 } {
    const el1 = elements.find(e => e.number === atom1.elementNumber);
    const el2 = elements.find(e => e.number === atom2.elementNumber);

    if (!el1?.electronegativity || !el2?.electronegativity) {
        return { polarity: 0, direction: 0 };
    }

    const diff = Math.abs(el1.electronegativity - el2.electronegativity);
    const direction: 1 | -1 | 0 = el1.electronegativity > el2.electronegativity ? 1 :
        el1.electronegativity < el2.electronegativity ? -1 : 0;

    return { polarity: diff, direction };
}

function getBondCharacter(polarity: number): 'nonpolar' | 'polar-covalent' | 'ionic' {
    if (polarity < 0.4) return 'nonpolar';
    if (polarity < 1.7) return 'polar-covalent';
    return 'ionic';
}

function calculateVSEPRGeometry(bondingPairs: number, lonePairs: number): VSEPRGeometry {
    const key = `${bondingPairs}-${lonePairs}`;
    return VSEPR_GEOMETRIES[key] || 'tetrahedral';
}

function determineHybridization(stericNumber: number): HybridizationState {
    switch (stericNumber) {
        case 2: return 'sp';
        case 3: return 'sp2';
        case 4: return 'sp3';
        case 5: return 'sp3d';
        case 6: return 'sp3d2';
        default: return 'none';
    }
}

function calculateBondLength(atom1: MoleculeAtom, atom2: MoleculeAtom): number {
    const r1 = COVALENT_RADII[atom1.elementNumber] ?? 1.0;
    const r2 = COVALENT_RADII[atom2.elementNumber] ?? 1.0;
    return r1 + r2;
}

function calculateMolecularFormula(atoms: MoleculeAtom[], elements: ElementData[]): string {
    const counts: Record<string, number> = {};
    atoms.forEach(atom => {
        const el = elements.find(e => e.number === atom.elementNumber);
        if (el) {
            counts[el.symbol] = (counts[el.symbol] || 0) + 1;
        }
    });

    // Hill system: C first, H second, then alphabetical
    const symbols = Object.keys(counts);
    const ordered: string[] = [];
    if (counts['C']) {
        ordered.push('C');
        symbols.splice(symbols.indexOf('C'), 1);
    }
    if (counts['H']) {
        ordered.push('H');
        symbols.splice(symbols.indexOf('H'), 1);
    }
    symbols.sort().forEach(s => ordered.push(s));

    return ordered.map(s => s + (counts[s] > 1 ? counts[s] : '')).join('');
}

function calculateMolecularMass(atoms: MoleculeAtom[], elements: ElementData[]): number {
    return atoms.reduce((sum, atom) => {
        const el = elements.find(e => e.number === atom.elementNumber);
        return sum + (el?.mass ?? 0);
    }, 0);
}

function calculateCenterOfMass(atoms: MoleculeAtom[], elements: ElementData[]): Position3D {
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };

    let totalMass = 0;
    let cx = 0, cy = 0, cz = 0;

    atoms.forEach(atom => {
        const el = elements.find(e => e.number === atom.elementNumber);
        const mass = el?.mass ?? 1;
        totalMass += mass;
        cx += atom.position.x * mass;
        cy += atom.position.y * mass;
        cz += atom.position.z * mass;
    });

    return { x: cx / totalMass, y: cy / totalMass, z: cz / totalMass };
}

function createEmptyMolecule(): Molecule {
    const now = new Date().toISOString();
    return {
        atoms: [],
        bonds: [],
        metadata: {
            name: 'Untitled',
            formula: '',
            molecularMass: 0,
            createdAt: now,
            modifiedAt: now,
            source: 'user',
        },
        centerOfMass: { x: 0, y: 0, z: 0 },
    };
}

function createAtom(elementNumber: number, position: Position3D): MoleculeAtom {
    return {
        id: generateId(),
        elementNumber,
        position,
        hybridization: 'none',
        formalCharge: 0,
        lonePairs: 0,
        bondedAtomIds: [],
    };
}

function createBond(
    atom1: MoleculeAtom,
    atom2: MoleculeAtom,
    type: BondType,
    elements: ElementData[]
): MoleculeBond {
    const order = type === 'single' ? 1 : type === 'double' ? 2 : type === 'triple' ? 3 : 1;
    const { polarity, direction } = calculateBondPolarity(atom1, atom2, elements);
    const length = calculateBondLength(atom1, atom2);

    return {
        id: generateId(),
        atom1Id: atom1.id,
        atom2Id: atom2.id,
        type,
        order,
        polarity,
        polarDirection: direction,
        length,
    };
}

// Calculate unit cell vectors from lattice parameters
function calculateUnitCellVectors(params: CrystalLatticeParams): THREE.Vector3[] {
    const { a, b, c, alpha, beta, gamma } = params;
    const alphaRad = THREE.MathUtils.degToRad(alpha);
    const betaRad = THREE.MathUtils.degToRad(beta);
    const gammaRad = THREE.MathUtils.degToRad(gamma);

    const va = new THREE.Vector3(a, 0, 0);
    const vb = new THREE.Vector3(
        b * Math.cos(gammaRad),
        b * Math.sin(gammaRad),
        0
    );

    const cx = c * Math.cos(betaRad);
    const cy = c * (Math.cos(alphaRad) - Math.cos(betaRad) * Math.cos(gammaRad)) / Math.sin(gammaRad);
    const czSq = c * c - cx * cx - cy * cy;
    const cz = czSq > 0 ? Math.sqrt(czSq) : 0;
    const vc = new THREE.Vector3(cx, cy, cz);

    return [va, vb, vc];
}

// ================= MOLECULE VIEWER 3D =================

const MoleculeViewer3D: React.FC<MoleculeViewer3DProps> = ({
    molecule,
    crystal,
    elements,
    selectedAtomId,
    selectedBondId,
    builderMode,
    selectedElement,
    bondTypeToCreate,
    showUnitCell,
    showElectrons,
    onAtomSelect,
    onBondSelect,
    onAtomAdd,
    onAtomMove,
    onBondCreate,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const animationIdRef = useRef<number>(0);
    const raycasterRef = useRef<THREE.Raycaster | null>(null);
    const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

    // Mesh groups for organizing scene objects
    const atomGroupRef = useRef<THREE.Group | null>(null);
    const bondGroupRef = useRef<THREE.Group | null>(null);
    const electronGroupRef = useRef<THREE.Group | null>(null);
    const gridGroupRef = useRef<THREE.Group | null>(null);
    const unitCellRef = useRef<THREE.LineSegments | null>(null);

    // Animation time for electron orbits
    const electronTimeRef = useRef(0);

    // Maps for tracking meshes
    const atomMeshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
    const bondMeshMapRef = useRef<Map<string, THREE.Group>>(new Map());

    // Bond creation state
    const bondStartAtomRef = useRef<string | null>(null);

    // Dragging state
    const isDraggingRef = useRef(false);
    const dragAtomIdRef = useRef<string | null>(null);
    const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

    // Initialize Scene
    useEffect(() => {
        if (!containerRef.current || !canvasRef.current) return;

        const container = containerRef.current;
        const canvas = canvasRef.current;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0e1a);
        scene.fog = new THREE.FogExp2(0x0a0e1a, 0.008);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500);
        camera.position.set(10, 8, 15);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        rendererRef.current = renderer;

        // Controls
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 3;
        controls.maxDistance = 100;
        controlsRef.current = controls;

        // Raycaster
        const raycaster = new THREE.Raycaster();
        raycasterRef.current = raycaster;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(10, 20, 10);
        mainLight.castShadow = true;
        scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0x88ccff, 0.4);
        fillLight.position.set(-10, 5, -10);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0xff8844, 0.6);
        rimLight.position.set(0, -10, 10);
        scene.add(rimLight);

        // Groups
        const atomGroup = new THREE.Group();
        atomGroup.name = 'atoms';
        scene.add(atomGroup);
        atomGroupRef.current = atomGroup;

        const bondGroup = new THREE.Group();
        bondGroup.name = 'bonds';
        scene.add(bondGroup);
        bondGroupRef.current = bondGroup;

        const electronGroup = new THREE.Group();
        electronGroup.name = 'electrons';
        scene.add(electronGroup);
        electronGroupRef.current = electronGroup;

        const gridGroup = new THREE.Group();
        gridGroup.name = 'grid';
        scene.add(gridGroup);
        gridGroupRef.current = gridGroup;

        // Grid helper
        const gridHelper = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
        gridHelper.position.y = -0.01;
        gridGroup.add(gridHelper);

        // Axes helper (subtle)
        const axesHelper = new THREE.AxesHelper(2);
        axesHelper.position.set(-9, 0, -9);
        gridGroup.add(axesHelper);

        // Animation loop
        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Resize handling
        const handleResize = () => {
            if (!containerRef.current) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            if (width === 0 || height === 0) return;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        setTimeout(handleResize, 100);

        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(animationIdRef.current);
            renderer.dispose();
        };
    }, []);

    // Update atoms when molecule changes
    useEffect(() => {
        if (!atomGroupRef.current || !sceneRef.current) return;

        const atomGroup = atomGroupRef.current;

        // Clear all existing atoms when showElectrons changes to recreate with new size
        atomMeshMapRef.current.forEach((mesh) => {
            atomGroup.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });
        atomMeshMapRef.current.clear();

        // Add atoms with appropriate size
        molecule.atoms.forEach(atom => {
            const color = ELEMENT_COLORS[atom.elementNumber] ?? DEFAULT_ELEMENT_COLOR;
            // Use much smaller radius when showing electrons (nucleus size)
            const baseRadius = (VAN_DER_WAALS_RADII[atom.elementNumber] ?? 1.5);
            const radius = showElectrons ? baseRadius * 0.08 : baseRadius * 0.3;

            // Create atom mesh
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            const material = new THREE.MeshPhysicalMaterial({
                color: showElectrons ? 0xff4444 : color, // Red nucleus in electron mode
                roughness: 0.3,
                metalness: 0.1,
                clearcoat: 0.5,
                clearcoatRoughness: 0.1,
                emissive: atom.id === selectedAtomId ? 0x00ffff : 0x000000,
                emissiveIntensity: atom.id === selectedAtomId ? 0.5 : 0,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(atom.position.x, atom.position.y, atom.position.z);
            mesh.userData.atomId = atom.id;
            mesh.userData.elementNumber = atom.elementNumber;

            atomGroup.add(mesh);
            atomMeshMapRef.current.set(atom.id, mesh);
        });
    }, [molecule.atoms, selectedAtomId, showElectrons]);

    // Update bonds when molecule changes
    useEffect(() => {
        if (!bondGroupRef.current) return;

        const bondGroup = bondGroupRef.current;

        // Clear all existing bonds
        bondMeshMapRef.current.forEach((group) => {
            bondGroup.remove(group);
            group.traverse((obj: any) => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    (obj.material as THREE.Material).dispose();
                }
            });
        });
        bondMeshMapRef.current.clear();

        // Don't render bonds when showing electrons - electrons show the connections
        if (showElectrons) return;

        // Add bonds
        molecule.bonds.forEach(bond => {
            const atom1 = molecule.atoms.find(a => a.id === bond.atom1Id);
            const atom2 = molecule.atoms.find(a => a.id === bond.atom2Id);
            if (!atom1 || !atom2) return;

            // Create bond geometry
            const start = new THREE.Vector3(atom1.position.x, atom1.position.y, atom1.position.z);
            const end = new THREE.Vector3(atom2.position.x, atom2.position.y, atom2.position.z);
            const direction = new THREE.Vector3().subVectors(end, start);
            const length = direction.length();
            const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

            const group = new THREE.Group();
            group.userData.bondId = bond.id;

            const bondCount = Math.min(Math.round(bond.order), 3);
            const offset = bondCount > 1 ? 0.12 : 0;

            // Get perpendicular vector for multiple bonds
            const up = new THREE.Vector3(0, 1, 0);
            let perpendicular = new THREE.Vector3().crossVectors(direction, up).normalize();
            if (perpendicular.length() < 0.1) {
                perpendicular = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(1, 0, 0)).normalize();
            }

            for (let i = 0; i < bondCount; i++) {
                const cylinderRadius = bond.id === selectedBondId ? 0.08 : 0.06;
                const geometry = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, length, 8);

                // Color based on polarity
                let color = 0x888888;
                if (bond.polarity > 1.7) {
                    color = 0xff6666; // Ionic - red tint
                } else if (bond.polarity > 0.4) {
                    color = 0x66aaff; // Polar covalent - blue tint
                }

                const material = new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.5,
                    metalness: 0.2,
                    emissive: bond.id === selectedBondId ? 0x00ffff : 0x000000,
                    emissiveIntensity: bond.id === selectedBondId ? 0.3 : 0,
                });

                const cylinder = new THREE.Mesh(geometry, material);

                // Position at midpoint
                cylinder.position.copy(midpoint);

                // Offset for multiple bonds
                if (bondCount > 1) {
                    const offsetVec = perpendicular.clone().multiplyScalar((i - (bondCount - 1) / 2) * offset);
                    cylinder.position.add(offsetVec);
                }

                // Orient along bond direction
                cylinder.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    direction.clone().normalize()
                );

                group.add(cylinder);
            }

            bondGroup.add(group);
            bondMeshMapRef.current.set(bond.id, group);
        });
    }, [molecule.bonds, molecule.atoms, selectedBondId, showElectrons]);

    // Update unit cell when crystal changes
    useEffect(() => {
        if (!sceneRef.current) return;

        // Remove existing unit cell
        if (unitCellRef.current) {
            sceneRef.current.remove(unitCellRef.current);
            unitCellRef.current.geometry.dispose();
            (unitCellRef.current.material as THREE.Material).dispose();
            unitCellRef.current = null;
        }

        if (!crystal || !showUnitCell) return;

        const [va, vb, vc] = calculateUnitCellVectors(crystal.params);

        // Create vertices of the unit cell
        const o = new THREE.Vector3(0, 0, 0);
        const vertices = [
            o.clone(),
            va.clone(),
            va.clone().add(vb),
            vb.clone(),
            vc.clone(),
            vc.clone().add(va),
            vc.clone().add(va).add(vb),
            vc.clone().add(vb),
        ];

        // Define edges
        const edges: [number, number][] = [
            [0, 1], [1, 2], [2, 3], [3, 0], // Bottom
            [4, 5], [5, 6], [6, 7], [7, 4], // Top
            [0, 4], [1, 5], [2, 6], [3, 7], // Verticals
        ];

        const points: THREE.Vector3[] = [];
        edges.forEach(([i, j]) => {
            points.push(vertices[i], vertices[j]);
        });

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.6,
        });

        const lineSegments = new THREE.LineSegments(geometry, material);
        sceneRef.current.add(lineSegments);
        unitCellRef.current = lineSegments;

    }, [crystal, showUnitCell]);

    // Update electrons when showElectrons changes or molecule changes
    useEffect(() => {
        if (!electronGroupRef.current || !sceneRef.current) return;

        const electronGroup = electronGroupRef.current;

        // Clear existing electrons
        while (electronGroup.children.length > 0) {
            const child = electronGroup.children[0];
            electronGroup.remove(child);
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
            }
        }

        if (!showElectrons) return;

        // Electron shell configuration - max electrons per shell
        const shellCapacity = [2, 8, 18, 32, 32, 18, 8]; // K, L, M, N, O, P, Q shells

        // Get electron configuration for an element
        const getElectronShells = (atomicNumber: number): number[] => {
            const shells: number[] = [];
            let remaining = atomicNumber;
            for (let i = 0; i < shellCapacity.length && remaining > 0; i++) {
                const electronsInShell = Math.min(remaining, shellCapacity[i]);
                shells.push(electronsInShell);
                remaining -= electronsInShell;
            }
            return shells;
        };

        // Shell colors - different color for each shell
        const shellColors = [
            0x00ffff, // K shell - cyan
            0x00ff00, // L shell - green
            0xffff00, // M shell - yellow
            0xff8800, // N shell - orange
            0xff0088, // O shell - pink
            0x8800ff, // P shell - purple
            0x0088ff, // Q shell - blue
        ];

        // Electron appearance
        const electronGeometry = new THREE.SphereGeometry(0.06, 12, 12);

        // First, gather bond information for each atom
        const atomBondInfo = new Map<string, { directions: THREE.Vector3[], electronsUsed: number }>();

        molecule.atoms.forEach(atom => {
            const connectedBonds = molecule.bonds.filter(b => b.atom1Id === atom.id || b.atom2Id === atom.id);
            const directions: THREE.Vector3[] = [];
            let electronsUsed = 0;

            connectedBonds.forEach(bond => {
                const otherAtomId = bond.atom1Id === atom.id ? bond.atom2Id : bond.atom1Id;
                const otherAtom = molecule.atoms.find(a => a.id === otherAtomId);
                if (otherAtom) {
                    const dir = new THREE.Vector3(
                        otherAtom.position.x - atom.position.x,
                        otherAtom.position.y - atom.position.y,
                        otherAtom.position.z - atom.position.z
                    ).normalize();
                    // Add direction for each electron in the bond
                    for (let i = 0; i < bond.order; i++) {
                        directions.push(dir.clone());
                        electronsUsed++;
                    }
                }
            });

            atomBondInfo.set(atom.id, { directions, electronsUsed });
        });

        // Render electrons for each atom
        molecule.atoms.forEach((atom) => {
            const atomPos = new THREE.Vector3(atom.position.x, atom.position.y, atom.position.z);
            const electronShells = getElectronShells(atom.elementNumber);
            const bondInfo = atomBondInfo.get(atom.id) || { directions: [], electronsUsed: 0 };

            // Base radius for innermost shell
            const baseRadius = 0.25;
            const shellSpacing = 0.2;

            // Track which valence electrons are used for bonding
            const valenceShellIndex = electronShells.length - 1;
            const valenceElectrons = electronShells[valenceShellIndex] || 0;
            let bondingElectronsPlaced = 0;

            electronShells.forEach((electronsInShell, shellIndex) => {
                const shellRadius = baseRadius + shellIndex * shellSpacing;
                const shellColor = shellColors[shellIndex] || 0xffffff;
                const isValenceShell = shellIndex === valenceShellIndex;

                // Create material for this shell
                const shellMaterial = new THREE.MeshPhysicalMaterial({
                    color: shellColor,
                    emissive: shellColor,
                    emissiveIntensity: 0.7,
                    roughness: 0.1,
                    metalness: 0.0,
                    transparent: true,
                    opacity: 0.85,
                });

                // For valence shell, position bonding electrons toward bonded atoms
                if (isValenceShell && bondInfo.directions.length > 0) {
                    const bondingCount = Math.min(bondInfo.electronsUsed, electronsInShell);
                    const nonBondingCount = electronsInShell - bondingCount;

                    // Place bonding electrons pointing toward bonded atoms
                    for (let e = 0; e < bondingCount; e++) {
                        const electron = new THREE.Mesh(electronGeometry.clone(), shellMaterial.clone());

                        // Get direction to bonded atom
                        const bondDir = bondInfo.directions[e % bondInfo.directions.length];

                        // Position electron extended toward the bond (80% out toward midpoint)
                        const extendedRadius = shellRadius * 1.8;
                        electron.position.set(
                            atomPos.x + bondDir.x * extendedRadius,
                            atomPos.y + bondDir.y * extendedRadius,
                            atomPos.z + bondDir.z * extendedRadius
                        );

                        electron.userData.atomId = atom.id;
                        electron.userData.shell = shellIndex;
                        electron.userData.isBonding = true;
                        electronGroup.add(electron);
                    }

                    // Place non-bonding electrons (lone pairs, etc.) in remaining positions
                    if (nonBondingCount > 0) {
                        // Calculate average bond direction to place non-bonding electrons opposite
                        const avgBondDir = new THREE.Vector3();
                        bondInfo.directions.forEach(d => avgBondDir.add(d));
                        avgBondDir.normalize();

                        // Get perpendicular vectors for distributing non-bonding electrons
                        const up = new THREE.Vector3(0, 1, 0);
                        let perp1 = new THREE.Vector3().crossVectors(avgBondDir, up).normalize();
                        if (perp1.length() < 0.1) {
                            perp1 = new THREE.Vector3().crossVectors(avgBondDir, new THREE.Vector3(1, 0, 0)).normalize();
                        }
                        const perp2 = new THREE.Vector3().crossVectors(avgBondDir, perp1).normalize();

                        for (let e = 0; e < nonBondingCount; e++) {
                            const electron = new THREE.Mesh(electronGeometry.clone(), shellMaterial.clone());

                            // Distribute non-bonding electrons away from bonds
                            const angle = (e / nonBondingCount) * Math.PI * 2;
                            const awayDir = avgBondDir.clone().negate()
                                .add(perp1.clone().multiplyScalar(Math.cos(angle) * 0.5))
                                .add(perp2.clone().multiplyScalar(Math.sin(angle) * 0.5))
                                .normalize();

                            electron.position.set(
                                atomPos.x + awayDir.x * shellRadius,
                                atomPos.y + awayDir.y * shellRadius,
                                atomPos.z + awayDir.z * shellRadius
                            );

                            electron.userData.atomId = atom.id;
                            electron.userData.shell = shellIndex;
                            electron.userData.isLonePair = true;
                            electronGroup.add(electron);
                        }
                    }
                } else {
                    // Inner shells or unbonded atoms - distribute evenly on sphere
                    for (let e = 0; e < electronsInShell; e++) {
                        const electron = new THREE.Mesh(electronGeometry.clone(), shellMaterial.clone());

                        // Use golden angle distribution for even spacing on sphere
                        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
                        const theta = goldenAngle * e;
                        const phi = Math.acos(1 - 2 * (e + 0.5) / electronsInShell);

                        // Convert spherical to cartesian
                        const x = shellRadius * Math.sin(phi) * Math.cos(theta);
                        const y = shellRadius * Math.sin(phi) * Math.sin(theta);
                        const z = shellRadius * Math.cos(phi);

                        electron.position.set(
                            atomPos.x + x,
                            atomPos.y + y,
                            atomPos.z + z
                        );

                        electron.userData.atomId = atom.id;
                        electron.userData.shell = shellIndex;
                        electron.userData.isElectron = true;
                        electronGroup.add(electron);
                    }
                }

                // Add a faint shell orbit ring for visual clarity
                const ringGeometry = new THREE.RingGeometry(shellRadius - 0.01, shellRadius + 0.01, 64);
                const ringMaterial = new THREE.MeshBasicMaterial({
                    color: shellColor,
                    transparent: true,
                    opacity: 0.15,
                    side: THREE.DoubleSide,
                });

                // Create 3 rings for each shell (XY, XZ, YZ planes)
                const ringXY = new THREE.Mesh(ringGeometry.clone(), ringMaterial.clone());
                ringXY.position.copy(atomPos);
                electronGroup.add(ringXY);

                const ringXZ = new THREE.Mesh(ringGeometry.clone(), ringMaterial.clone());
                ringXZ.position.copy(atomPos);
                ringXZ.rotation.x = Math.PI / 2;
                electronGroup.add(ringXZ);

                const ringYZ = new THREE.Mesh(ringGeometry.clone(), ringMaterial.clone());
                ringYZ.position.copy(atomPos);
                ringYZ.rotation.y = Math.PI / 2;
                electronGroup.add(ringYZ);
            });
        });

    }, [showElectrons, molecule.atoms, molecule.bonds]);

    // Mouse handlers
    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        if (!canvasRef.current || !cameraRef.current || !raycasterRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
        const atomMeshes = Array.from(atomMeshMapRef.current.values());
        const intersects = raycasterRef.current.intersectObjects(atomMeshes);

        if (builderMode === 'select') {
            if (intersects.length > 0) {
                const atomId = intersects[0].object.userData.atomId;
                onAtomSelect(atomId);
            } else {
                onAtomSelect(null);
            }
        } else if (builderMode === 'add') {
            if (intersects.length === 0 && gridGroupRef.current) {
                // Click on grid plane - add atom
                const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                const intersection = new THREE.Vector3();
                raycasterRef.current.ray.intersectPlane(gridPlane, intersection);
                if (intersection) {
                    // Snap to grid (0.5 units)
                    intersection.x = Math.round(intersection.x * 2) / 2;
                    intersection.z = Math.round(intersection.z * 2) / 2;
                    intersection.y = 0;
                    onAtomAdd({ x: intersection.x, y: intersection.y, z: intersection.z });
                }
            }
        } else if (builderMode === 'bond') {
            if (intersects.length > 0) {
                const atomId = intersects[0].object.userData.atomId;
                if (bondStartAtomRef.current === null) {
                    // First atom selected
                    bondStartAtomRef.current = atomId;
                    onAtomSelect(atomId);
                } else if (bondStartAtomRef.current !== atomId) {
                    // Second atom selected - create bond
                    onBondCreate(bondStartAtomRef.current, atomId);
                    bondStartAtomRef.current = null;
                    onAtomSelect(null);
                }
            } else {
                // Clicked empty space - cancel bond creation
                bondStartAtomRef.current = null;
                onAtomSelect(null);
            }
        } else if (builderMode === 'move') {
            if (intersects.length > 0) {
                const atomId = intersects[0].object.userData.atomId;
                isDraggingRef.current = true;
                dragAtomIdRef.current = atomId;
                onAtomSelect(atomId);
                if (controlsRef.current) {
                    controlsRef.current.enabled = false;
                }
            }
        }
    }, [builderMode, onAtomSelect, onAtomAdd, onBondCreate]);

    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (!isDraggingRef.current || !dragAtomIdRef.current) return;
        if (!canvasRef.current || !cameraRef.current || !raycasterRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
        const intersection = new THREE.Vector3();
        raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersection);

        if (intersection) {
            // Snap to grid
            intersection.x = Math.round(intersection.x * 2) / 2;
            intersection.z = Math.round(intersection.z * 2) / 2;
            onAtomMove(dragAtomIdRef.current, { x: intersection.x, y: 0, z: intersection.z });
        }
    }, [onAtomMove]);

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false;
        dragAtomIdRef.current = null;
        if (controlsRef.current) {
            controlsRef.current.enabled = true;
        }
    }, []);

    // Get unique elements in the molecule for the legend
    const uniqueElements = Array.from(new Set(molecule.atoms.map(a => a.elementNumber)))
        .sort((a, b) => a - b)
        .map(num => {
            const el = elements.find(e => e.number === num);
            return { number: num, symbol: el?.symbol || '?', name: el?.name || 'Unknown' };
        });

    // Element colors for legend (matching ELEMENT_COLORS)
    const getElementColor = (num: number): string => {
        const colors: Record<number, string> = {
            1: '#FFFFFF', 2: '#D9FFFF', 3: '#CC80FF', 4: '#C2FF00', 5: '#FFB5B5',
            6: '#909090', 7: '#3050F8', 8: '#FF0D0D', 9: '#90E050', 10: '#B3E3F5',
            11: '#AB5CF2', 12: '#8AFF00', 13: '#BFA6A6', 14: '#F0C8A0', 15: '#FF8000',
            16: '#FFFF30', 17: '#1FF01F', 18: '#80D1E3', 19: '#8F40D4', 20: '#3DFF00',
            26: '#E06633', 29: '#C88033', 30: '#7D80B0', 35: '#A62929', 47: '#C0C0C0',
            53: '#940094', 79: '#FFD123', 80: '#B8B8D0', 82: '#575961'
        };
        return colors[num] || '#808080';
    };

    // Shell colors for electron legend
    const shellColors = [
        { shell: 'K', color: '#00FFFF', label: 'K Shell (1-2)' },
        { shell: 'L', color: '#00FF00', label: 'L Shell (3-10)' },
        { shell: 'M', color: '#FFFF00', label: 'M Shell (11-28)' },
        { shell: 'N', color: '#FF8800', label: 'N Shell (29-60)' },
        { shell: 'O', color: '#FF0088', label: 'O Shell (61-92)' },
    ];

    return (
        <div
            ref={containerRef}
            className="w-full h-full relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <canvas ref={canvasRef} className="w-full h-full" />

            {/* Legend */}
            <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 max-w-[180px] max-h-[300px] overflow-y-auto">
                {/* Elements Legend */}
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">
                    {showElectrons ? 'Nuclei' : 'Elements'}
                </div>
                <div className="space-y-1 mb-3">
                    {uniqueElements.map(el => (
                        <div key={el.number} className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full border border-white/30"
                                style={{ backgroundColor: showElectrons ? '#FF4444' : getElementColor(el.number) }}
                            />
                            <span className="text-xs text-slate-300">
                                {el.symbol} - {el.name}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Electron Shell Legend (only when showElectrons is true) */}
                {showElectrons && (
                    <>
                        <div className="border-t border-slate-700 my-2" />
                        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">
                            Electron Shells
                        </div>
                        <div className="space-y-1">
                            {shellColors.map(({ shell, color, label }) => (
                                <div key={shell} className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
                                    />
                                    <span className="text-xs text-slate-300">{label}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Mode indicator */}
            <div className="absolute bottom-4 left-4 text-xs text-slate-400 bg-slate-900/80 px-2 py-1 rounded">
                {builderMode === 'bond' && bondStartAtomRef.current
                    ? 'Click second atom to complete bond'
                    : `Mode: ${builderMode.charAt(0).toUpperCase() + builderMode.slice(1)}`}
            </div>
            {/* Atom count */}
            <div className="absolute bottom-4 right-4 text-xs text-slate-400 bg-slate-900/80 px-2 py-1 rounded">
                {molecule.atoms.length} atoms, {molecule.bonds.length} bonds
            </div>
        </div>
    );
};

// ================= MAIN COMPONENT =================

type ViewMode = 'periodic-table' | 'molecule-builder';

// Default color for unknown categories
const DEFAULT_COLOR = { from: "#475569", via: "#334155", to: "#1e293b" };

export const PeriodicTableWorkflow: React.FC = () => {
    // Data state - loaded from JSON
    const [elements, setElements] = useState<ElementData[]>([]);
    const [CATEGORY_COLORS, setCategoryColors] = useState<Record<string, { from: string; via: string; to: string }>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // UI state
    const [selectedElement, setSelectedElement] = useState<ElementData | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [electronsLocked, setElectronsLocked] = useState(false);
    const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>('bohr');
    const [viewMode, setViewMode] = useState<ViewMode>('periodic-table');
    const [orbitalVisibility, setOrbitalVisibility] = useState<OrbitalVisibility>({ s: true, p: true, d: true, f: true });

    // Resizable sidebar state
    const [sidebarWidth, setSidebarWidth] = useState(Math.round(window.innerWidth * 0.3)); // 30% default
    const sidebarResizingRef = useRef(false);

    // ================= MOLECULE BUILDER STATE (must be before any conditional returns) =================
    const [molecule, setMolecule] = useState<Molecule>(createEmptyMolecule);
    const [crystal, setCrystal] = useState<CrystalLattice | null>(null);
    const [builderMode, setBuilderMode] = useState<BuilderMode>('select');
    const [selectedAtomId, setSelectedAtomId] = useState<string | null>(null);
    const [selectedBondId, setSelectedBondId] = useState<string | null>(null);
    const [bondTypeToCreate, setBondTypeToCreate] = useState<BondType>('single');
    const [showUnitCell, setShowUnitCell] = useState(false);
    const [showCrystalPanel, setShowCrystalPanel] = useState(false);
    const [showElectrons, setShowElectrons] = useState(false);
    const [showElementPicker, setShowElementPicker] = useState(false);

    // Load element data from JSON file on mount
    useEffect(() => {
        const loadElementData = async () => {
            try {
                const electron = (window as any).require?.('electron');
                if (!electron?.ipcRenderer) {
                    throw new Error('Electron IPC not available');
                }

                // Use resolve-workflow-script to get the correct path relative to this workflow
                const resolveResult = await electron.ipcRenderer.invoke('resolve-workflow-script', {
                    workflowFolder: 'PeriodicTable',
                    scriptName: 'elements.json'
                });

                let result = null;
                let lastError = '';

                if (resolveResult.success) {
                    console.log('[PeriodicTable] Resolved path:', resolveResult.path);
                    result = await electron.ipcRenderer.invoke('read-file', { filePath: resolveResult.path, encoding: 'utf-8' });
                    if (!result.success) {
                        lastError = result.error || 'Unknown error';
                    }
                } else {
                    // Fallback: try with DynamicModuleLoader
                    const DynamicModuleLoader = (window as any).DynamicModuleLoader;
                    let basePath = '';

                    if (DynamicModuleLoader) {
                        const loader = DynamicModuleLoader.getInstance();
                        basePath = loader.getWorkflowsBase() || loader.getCurrentFolderPath() || '';
                    }

                    // Try multiple possible paths for the JSON file
                    const possiblePaths = [
                        basePath ? `${basePath}\\PeriodicTable\\elements.json` : '',
                        basePath ? `${basePath}/PeriodicTable/elements.json` : '',
                        basePath ? `${basePath}\\elements.json` : '',
                        basePath ? `${basePath}/elements.json` : '',
                    ].filter(p => p);

                    for (const jsonPath of possiblePaths) {
                        console.log('[PeriodicTable] Trying to load from:', jsonPath);
                        result = await electron.ipcRenderer.invoke('read-file', { filePath: jsonPath, encoding: 'utf-8' });
                        if (result.success) {
                            console.log('[PeriodicTable] Successfully loaded from:', jsonPath);
                            break;
                        }
                        lastError = result.error || 'Unknown error';
                    }
                }

                if (!result?.success) {
                    throw new Error(`Could not find elements.json. Last error: ${lastError}`);
                }

                const data = JSON.parse(result.content);
                setElements(data.elements || []);
                setCategoryColors(data.CATEGORY_COLORS || {});
                setSelectedElement(data.elements?.[0] || null);
                setIsLoading(false);
                console.log('[PeriodicTable] Loaded', data.elements?.length, 'elements');
            } catch (err: any) {
                console.error('[PeriodicTable] Failed to load elements:', err);
                setLoadError(err.message);
                setIsLoading(false);
            }
        };

        loadElementData();
    }, []);

    // Listen for external element selection (from Voice Agent or other modules)
    useEffect(() => {
        const EventBus = (window as any).EventBus;
        if (!EventBus) return;

        const eventBus = EventBus.getInstance();

        const handleSelectElement = (data: { symbol?: string; number?: number; name?: string }) => {
            console.log('[PeriodicTable] Received select-element event:', data);
            let element: ElementData | undefined;

            // Find by symbol (case-insensitive)
            if (data.symbol) {
                element = elements.find(el => el.symbol.toLowerCase() === data.symbol!.toLowerCase());
            }
            // Find by atomic number
            else if (data.number) {
                element = elements.find(el => el.number === data.number);
            }
            // Find by name (case-insensitive)
            else if (data.name) {
                element = elements.find(el => el.name.toLowerCase() === data.name!.toLowerCase());
            }

            if (element) {
                setSelectedElement(element);
                console.log(`[PeriodicTable] Selected element: ${element.name} (${element.symbol})`);
                // Publish confirmation event so Voice Agent knows selection succeeded
                eventBus.emit('periodic-table:element-selected', {
                    symbol: element.symbol,
                    number: element.number,
                    name: element.name,
                    category: element.category,
                    mass: element.mass,
                    summary: element.summary?.substring(0, 200) // Truncate for LLM context
                });
            } else {
                console.warn(`[PeriodicTable] Element not found:`, data);
                // Publish failure event
                eventBus.emit('periodic-table:element-not-found', { requested: data });
            }
        };

        eventBus.on('periodic-table:select-element', handleSelectElement);
        console.log('[PeriodicTable] Registered listener for periodic-table:select-element, elements count:', elements.length);

        return () => {
            console.log('[PeriodicTable] Unregistering listener for periodic-table:select-element');
            eventBus.off('periodic-table:select-element', handleSelectElement);
        };
    }, [elements]);

    // EventBus listener for view mode switching (always active, separate from molecule builder)
    useEffect(() => {
        const EventBus = (window as any).EventBus;
        if (!EventBus) return;

        const eventBus = EventBus.getInstance();

        const handleSetViewMode = (data: { mode: string }) => {
            if (data.mode === 'periodic-table' || data.mode === 'molecule-builder') {
                console.log('[PeriodicTable] Setting view mode to:', data.mode);
                setViewMode(data.mode as ViewMode);
            }
        };

        eventBus.on('periodic-table:set-view-mode', handleSetViewMode);

        return () => {
            eventBus.off('periodic-table:set-view-mode', handleSetViewMode);
        };
    }, []);

    // Helper function to select element and emit event
    const selectElement = useCallback((element: ElementData) => {
        setSelectedElement(element);
        // Emit event for Voice Agent and other listeners
        const EventBus = (window as any).EventBus;
        if (EventBus) {
            const eventBus = EventBus.getInstance();
            eventBus.emit('periodic-table:element-selected', {
                symbol: element.symbol,
                number: element.number,
                name: element.name,
                category: element.category,
                mass: element.mass,
                summary: element.summary?.substring(0, 200)
            });
        }
    }, []);

    // CSS Grid for Periodic Table - using Tailwind classes in JSX
    // gridStyle constant removed - using className instead

    // Get legend items (unique categories) - show ALL categories
    const legendItems = useMemo(() => {
        const uniqueCategories = Array.from(new Set(elements.map(el => el.category)));
        return uniqueCategories.map(cat => ({
            category: cat,
            color: CATEGORY_COLORS[cat] || DEFAULT_COLOR
        }));
    }, [elements, CATEGORY_COLORS]);

    // Sidebar resize handlers
    const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        sidebarResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!sidebarResizingRef.current) return;
            const containerWidth = window.innerWidth;
            const maxWidth = containerWidth * 0.5;
            const newWidth = Math.max(250, Math.min(e.clientX, maxWidth));
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            if (sidebarResizingRef.current) {
                sidebarResizingRef.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // ================= MOLECULE BUILDER HOOKS (must be before any conditional returns) =================
    // Common elements for quick access
    const commonElements = useMemo(() => {
        return [1, 6, 7, 8, 9, 15, 16, 17, 11, 12, 19, 20, 26, 29].map(n =>
            elements.find(e => e.number === n)
        ).filter(Boolean) as ElementData[];
    }, [elements]);

    // Molecule builder handlers
    const handleAtomAdd = useCallback((position: Position3D) => {
        if (!selectedElement) return;
        const newAtom = createAtom(selectedElement.number, position);
        setMolecule(prev => {
            const updated = {
                ...prev,
                atoms: [...prev.atoms, newAtom],
                metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
            };
            updated.metadata.formula = calculateMolecularFormula(updated.atoms, elements);
            updated.metadata.molecularMass = calculateMolecularMass(updated.atoms, elements);
            updated.centerOfMass = calculateCenterOfMass(updated.atoms, elements);
            return updated;
        });
    }, [selectedElement, elements]);

    const handleAtomMove = useCallback((atomId: string, position: Position3D) => {
        setMolecule(prev => ({
            ...prev,
            atoms: prev.atoms.map(a => a.id === atomId ? { ...a, position } : a),
            metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
        }));
    }, []);

    const handleBondCreate = useCallback((atom1Id: string, atom2Id: string) => {
        const atom1 = molecule.atoms.find(a => a.id === atom1Id);
        const atom2 = molecule.atoms.find(a => a.id === atom2Id);
        if (!atom1 || !atom2) return;

        // Check if bond already exists between these atoms
        const existingBond = molecule.bonds.find(b =>
            (b.atom1Id === atom1Id && b.atom2Id === atom2Id) ||
            (b.atom1Id === atom2Id && b.atom2Id === atom1Id)
        );

        if (existingBond) {
            // Upgrade existing bond to the selected type or cycle through bond orders
            const bondOrder = bondTypeToCreate === 'single' ? 1 : bondTypeToCreate === 'double' ? 2 : 3;
            const currentOrder = existingBond.order;

            // If clicking with same bond type, cycle to next order
            const newOrder = bondOrder === currentOrder ? Math.min(currentOrder + 1, 3) : bondOrder;
            const newType: BondType = newOrder === 1 ? 'single' : newOrder === 2 ? 'double' : 'triple';

            // Check valence for the upgrade
            const orderIncrease = newOrder - currentOrder;
            if (orderIncrease > 0) {
                if (!canFormBond(atom1, orderIncrease, molecule.bonds) || !canFormBond(atom2, orderIncrease, molecule.bonds)) {
                    console.warn('Cannot upgrade bond: valence exceeded');
                    return;
                }
            }

            setMolecule(prev => ({
                ...prev,
                bonds: prev.bonds.map((b: MoleculeBond) =>
                    b.id === existingBond.id
                        ? { ...b, type: newType, order: newOrder }
                        : b
                ),
                metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
            }));
            console.log(`Bond upgraded to ${newType}`);
            return;
        }

        // Creating new bond - validate valence
        const bondOrder = bondTypeToCreate === 'single' ? 1 : bondTypeToCreate === 'double' ? 2 : 3;
        if (!canFormBond(atom1, bondOrder, molecule.bonds) || !canFormBond(atom2, bondOrder, molecule.bonds)) {
            console.warn('Cannot form bond: valence exceeded');
            return;
        }

        const newBond = createBond(atom1, atom2, bondTypeToCreate, elements);
        setMolecule(prev => {
            const updatedAtoms = prev.atoms.map(a => {
                if (a.id === atom1Id) return { ...a, bondedAtomIds: [...a.bondedAtomIds, atom2Id] };
                if (a.id === atom2Id) return { ...a, bondedAtomIds: [...a.bondedAtomIds, atom1Id] };
                return a;
            });
            return {
                ...prev,
                atoms: updatedAtoms,
                bonds: [...prev.bonds, newBond],
                metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
            };
        });
    }, [molecule, bondTypeToCreate, elements]);

    const handleDeleteSelected = useCallback(() => {
        if (selectedAtomId) {
            setMolecule(prev => {
                const updatedAtoms = prev.atoms.filter(a => a.id !== selectedAtomId);
                const updatedBonds = prev.bonds.filter(b =>
                    b.atom1Id !== selectedAtomId && b.atom2Id !== selectedAtomId
                );
                // Remove from bondedAtomIds
                const cleanedAtoms = updatedAtoms.map(a => ({
                    ...a,
                    bondedAtomIds: a.bondedAtomIds.filter(id => id !== selectedAtomId)
                }));
                const updated = {
                    ...prev,
                    atoms: cleanedAtoms,
                    bonds: updatedBonds,
                    metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
                };
                updated.metadata.formula = calculateMolecularFormula(updated.atoms, elements);
                updated.metadata.molecularMass = calculateMolecularMass(updated.atoms, elements);
                updated.centerOfMass = calculateCenterOfMass(updated.atoms, elements);
                return updated;
            });
            setSelectedAtomId(null);
        } else if (selectedBondId) {
            setMolecule(prev => {
                const bond = prev.bonds.find(b => b.id === selectedBondId);
                if (!bond) return prev;
                const updatedAtoms = prev.atoms.map(a => {
                    if (a.id === bond.atom1Id) {
                        return { ...a, bondedAtomIds: a.bondedAtomIds.filter(id => id !== bond.atom2Id) };
                    }
                    if (a.id === bond.atom2Id) {
                        return { ...a, bondedAtomIds: a.bondedAtomIds.filter(id => id !== bond.atom1Id) };
                    }
                    return a;
                });
                return {
                    ...prev,
                    atoms: updatedAtoms,
                    bonds: prev.bonds.filter(b => b.id !== selectedBondId),
                    metadata: { ...prev.metadata, modifiedAt: new Date().toISOString() }
                };
            });
            setSelectedBondId(null);
        }
    }, [selectedAtomId, selectedBondId, elements]);

    const handleClearMolecule = useCallback(() => {
        setMolecule(createEmptyMolecule());
        setSelectedAtomId(null);
        setSelectedBondId(null);
    }, []);

    // Keyboard handler for delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (viewMode !== 'molecule-builder') return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                handleDeleteSelected();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [viewMode, handleDeleteSelected]);

    // EventBus integration for AI commands - always active to receive commands
    useEffect(() => {
        const EventBus = (window as any).EventBus;
        if (!EventBus) return;

        const eventBus = EventBus.getInstance();

        const handleAddAtom = (data: { element: string | number; position?: Position3D }) => {
            // Use functional update to access current state and generate proper atom ID
            setMolecule((prev: Molecule) => {
                const elementNumber = typeof data.element === 'string'
                    ? elements.find((e: ElementData) => e.symbol.toLowerCase() === (data.element as string).toLowerCase())?.number
                    : data.element;

                if (!elementNumber) {
                    eventBus.emit('molecule:error', { error: `Unknown element: ${data.element}` });
                    return prev;
                }

                // Get element symbol for the ID
                const elementData = elements.find((e: ElementData) => e.number === elementNumber);
                const symbol = elementData?.symbol || 'X';

                // Count existing atoms of this element to generate sequential ID (O1, O2, H1, H2, etc.)
                const existingCount = prev.atoms.filter((a: MoleculeAtom) => {
                    const atomElement = elements.find((e: ElementData) => e.number === a.elementNumber);
                    return atomElement?.symbol === symbol;
                }).length;
                const atomId = `${symbol}${existingCount + 1}`;

                const position = data.position || { x: Math.random() * 4 - 2, y: 0, z: Math.random() * 4 - 2 };

                // Create atom with semantic ID
                const newAtom: MoleculeAtom = {
                    id: atomId,
                    elementNumber,
                    position,
                    hybridization: 'none',
                    formalCharge: 0,
                    lonePairs: 0,
                    bondedAtomIds: [],
                };

                const updated = { ...prev, atoms: [...prev.atoms, newAtom] };
                updated.metadata.formula = calculateMolecularFormula(updated.atoms, elements);
                updated.metadata.molecularMass = calculateMolecularMass(updated.atoms, elements);

                // Emit with full structure for DualLLM feedback
                eventBus.emit('molecule:atom-added', {
                    atomId: newAtom.id,
                    element: symbol,
                    structure: {
                        atoms: updated.atoms,
                        bonds: updated.bonds,
                        metadata: updated.metadata
                    }
                });
                return updated;
            });
        };

        const handleCreateBond = (data: { atom1Id: string; atom2Id: string; bondType?: BondType }) => {
            // Use setMolecule with functional update to access current state
            setMolecule((prev: Molecule) => {
                const atom1 = prev.atoms.find((a: MoleculeAtom) => a.id === data.atom1Id);
                const atom2 = prev.atoms.find((a: MoleculeAtom) => a.id === data.atom2Id);
                if (!atom1 || !atom2) {
                    eventBus.emit('molecule:error', { error: `Atom not found: ${!atom1 ? data.atom1Id : data.atom2Id}. Available atoms: ${prev.atoms.map((a: MoleculeAtom) => a.id).join(', ')}` });
                    return prev; // Return unchanged state
                }
                const bond = createBond(atom1, atom2, data.bondType || 'single', elements);
                const updated = { ...prev, bonds: [...prev.bonds, bond] };
                // Emit with full structure for DualLLM feedback
                eventBus.emit('molecule:bond-created', {
                    bondId: bond.id,
                    structure: {
                        atoms: updated.atoms,
                        bonds: updated.bonds,
                        metadata: updated.metadata
                    }
                });
                return updated;
            });
        };

        const handleGetStructure = () => {
            // Use functional update to get current state
            setMolecule((prev: Molecule) => {
                eventBus.emit('molecule:structure-data', {
                    atoms: prev.atoms,
                    bonds: prev.bonds,
                    metadata: prev.metadata
                });
                return prev; // Return unchanged
            });
        };

        const handleClear = () => {
            setMolecule(createEmptyMolecule());
            eventBus.emit('molecule:cleared', {});
        };

        const handleLoadStructure = async (data: { name?: string; structureData?: any }) => {
            if (data.structureData) {
                // Load from provided data
                const fileData = data.structureData;
                if (fileData.molecule) {
                    const loadedMolecule: Molecule = {
                        atoms: fileData.molecule.atoms || [],
                        bonds: fileData.molecule.bonds || [],
                        metadata: fileData.molecule.metadata || {
                            name: fileData.name || 'AI Loaded Molecule',
                            formula: '',
                            molecularMass: 0,
                            createdAt: new Date().toISOString(),
                            modifiedAt: new Date().toISOString(),
                            source: 'ai'
                        },
                        centerOfMass: calculateCenterOfMass(fileData.molecule.atoms || [], elements)
                    };
                    loadedMolecule.metadata.formula = calculateMolecularFormula(loadedMolecule.atoms, elements);
                    loadedMolecule.metadata.molecularMass = calculateMolecularMass(loadedMolecule.atoms, elements);
                    setMolecule(loadedMolecule);
                    eventBus.emit('molecule:structure-loaded', {
                        source: 'data',
                        structure: {
                            atoms: loadedMolecule.atoms,
                            bonds: loadedMolecule.bonds,
                            metadata: loadedMolecule.metadata
                        }
                    });
                }
            } else if (data.name) {
                // Load preset by name
                const presetMap: Record<string, string> = {
                    'water': 'water.mol.json',
                    'h2o': 'water.mol.json',
                    'carbon-dioxide': 'carbon-dioxide.mol.json',
                    'co2': 'carbon-dioxide.mol.json',
                    'methane': 'methane.mol.json',
                    'ch4': 'methane.mol.json',
                    'ammonia': 'ammonia.mol.json',
                    'nh3': 'ammonia.mol.json',
                    'ethene': 'ethene.mol.json',
                    'ethylene': 'ethene.mol.json',
                    'c2h4': 'ethene.mol.json',
                    'benzene': 'benzene.mol.json',
                    'c6h6': 'benzene.mol.json',
                    'nacl': 'sodium-chloride.crystal.json',
                    'sodium-chloride': 'sodium-chloride.crystal.json',
                    'diamond': 'diamond.crystal.json',
                    'graphite': 'graphite.crystal.json',
                    'ice': 'ice-ih.crystal.json',
                    'ice-ih': 'ice-ih.crystal.json'
                };
                const fileName = presetMap[data.name.toLowerCase()];
                if (fileName) {
                    eventBus.emit('molecule:loading-preset', { name: fileName });
                    // Note: handleLoadPreset is defined later, but we can emit for external handling
                }
            }
        };

        const handleSaveStructure = () => {
            // Use functional update to get current state
            setMolecule((prev: Molecule) => {
                eventBus.emit('molecule:structure-data', {
                    version: '1.0.0',
                    type: 'molecule',
                    molecule: {
                        atoms: prev.atoms,
                        bonds: prev.bonds,
                        metadata: prev.metadata
                    }
                });
                return prev; // Return unchanged
            });
        };

        eventBus.on('molecule:add-atom', handleAddAtom);
        eventBus.on('molecule:create-bond', handleCreateBond);
        eventBus.on('molecule:get-structure', handleGetStructure);
        eventBus.on('molecule:clear', handleClear);
        eventBus.on('molecule:load-structure', handleLoadStructure);
        eventBus.on('molecule:save-structure', handleSaveStructure);

        return () => {
            eventBus.off('molecule:add-atom', handleAddAtom);
            eventBus.off('molecule:create-bond', handleCreateBond);
            eventBus.off('molecule:get-structure', handleGetStructure);
            eventBus.off('molecule:clear', handleClear);
            eventBus.off('molecule:load-structure', handleLoadStructure);
            eventBus.off('molecule:save-structure', handleSaveStructure);
        };
    }, [elements]); // Only depend on elements - use functional updates for molecule state

    // Emit structure changes
    useEffect(() => {
        if (viewMode !== 'molecule-builder' || molecule.atoms.length === 0) return;
        const EventBus = (window as any).EventBus;
        if (!EventBus) return;

        const eventBus = EventBus.getInstance();
        eventBus.emit('molecule:structure-changed', {
            atoms: molecule.atoms.length,
            bonds: molecule.bonds.length,
            formula: molecule.metadata.formula,
            mass: molecule.metadata.molecularMass
        });
    }, [viewMode, molecule]);

    // File Save/Load handlers
    const handleSaveMolecule = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) {
            console.error('ElectronAPI not available');
            return;
        }

        try {
            const result = await electronAPI.invoke('show-save-dialog', {
                title: 'Save Molecule',
                defaultPath: `${molecule.metadata.name || 'molecule'}.mol.json`,
                filters: [
                    { name: 'Molecule Files', extensions: ['mol.json'] },
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (result.canceled || !result.filePath) return;

            const fileData = {
                version: '1.0.0',
                type: crystal ? 'crystal' : 'molecule',
                name: molecule.metadata.name,
                molecule: {
                    atoms: molecule.atoms,
                    bonds: molecule.bonds,
                    metadata: molecule.metadata
                },
                ...(crystal && { crystal }),
                viewState: {
                    cameraPosition: { x: 0, y: 0, z: 10 },
                    cameraTarget: { x: 0, y: 0, z: 0 }
                }
            };

            const writeResult = await electronAPI.invoke('write-file', {
                filePath: result.filePath,
                content: JSON.stringify(fileData, null, 2),
                encoding: 'utf-8'
            });

            if (writeResult.success) {
                console.log('Molecule saved successfully to:', result.filePath);
            } else {
                console.error('Failed to save molecule:', writeResult.error);
            }
        } catch (error) {
            console.error('Error saving molecule:', error);
        }
    }, [molecule, crystal]);

    const handleLoadMolecule = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) {
            console.error('ElectronAPI not available');
            return;
        }

        try {
            const result = await electronAPI.invoke('show-open-dialog', {
                title: 'Load Molecule',
                filters: [
                    { name: 'Molecule Files', extensions: ['mol.json'] },
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

            const readResult = await electronAPI.invoke('read-file', {
                filePath: result.filePaths[0],
                encoding: 'utf-8'
            });

            if (!readResult.success) {
                console.error('Failed to read file:', readResult.error);
                return;
            }

            const fileData = JSON.parse(readResult.content);

            // Load molecule data
            if (fileData.molecule) {
                const loadedMolecule: Molecule = {
                    atoms: fileData.molecule.atoms || [],
                    bonds: fileData.molecule.bonds || [],
                    metadata: fileData.molecule.metadata || {
                        name: fileData.name || 'Loaded Molecule',
                        formula: '',
                        molecularMass: 0,
                        createdAt: new Date().toISOString(),
                        modifiedAt: new Date().toISOString(),
                        source: 'file'
                    },
                    centerOfMass: calculateCenterOfMass(fileData.molecule.atoms || [], elements)
                };

                // Recalculate formula and mass if not present
                if (!loadedMolecule.metadata.formula) {
                    loadedMolecule.metadata.formula = calculateMolecularFormula(loadedMolecule.atoms, elements);
                }
                if (!loadedMolecule.metadata.molecularMass) {
                    loadedMolecule.metadata.molecularMass = calculateMolecularMass(loadedMolecule.atoms, elements);
                }

                setMolecule(loadedMolecule);
            }

            // Load crystal data if present
            if (fileData.crystal) {
                setCrystal(fileData.crystal);
                setShowUnitCell(true);
            } else {
                setCrystal(null);
            }

            setSelectedAtomId(null);
            setSelectedBondId(null);
            console.log('Molecule loaded successfully from:', result.filePaths[0]);
        } catch (error) {
            console.error('Error loading molecule:', error);
        }
    }, [elements]);

    // Load preset molecule from examples folder
    const handleLoadPreset = useCallback(async (presetName: string) => {
        try {
            const electron = (window as any).require?.('electron');
            if (!electron?.ipcRenderer) {
                console.error('Electron IPC not available for preset loading');
                return;
            }

            // Get the workflows base path (same as elements.json loading)
            const DynamicModuleLoader = (window as any).DynamicModuleLoader;
            let basePath = '';

            if (DynamicModuleLoader) {
                const loader = DynamicModuleLoader.getInstance();
                basePath = loader.getWorkflowsBase() || loader.getCurrentFolderPath() || '';
            }

            // Try multiple possible paths for the molecule file
            const possiblePaths = [
                basePath ? `${basePath}\\PeriodicTable\\molecules\\${presetName}` : '',
                basePath ? `${basePath}/PeriodicTable/molecules/${presetName}` : '',
                // Fallback to example_modules location
                `example_modules\\PeriodicTable\\molecules\\${presetName}`,
                `example_modules/PeriodicTable/molecules/${presetName}`,
            ].filter(p => p);

            let fileData = null;
            for (const testPath of possiblePaths) {
                console.log('[MoleculeBuilder] Trying to load preset from:', testPath);
                const result = await electron.ipcRenderer.invoke('read-file', { filePath: testPath, encoding: 'utf-8' });
                if (result.success) {
                    console.log('[MoleculeBuilder] Successfully loaded preset from:', testPath);
                    fileData = JSON.parse(result.content);
                    break;
                }
            }

            if (!fileData) {
                console.warn(`[MoleculeBuilder] Could not load preset: ${presetName}`);
                return;
            }

            // Load molecule data
            if (fileData.molecule) {
                const loadedMolecule: Molecule = {
                    atoms: fileData.molecule.atoms || [],
                    bonds: fileData.molecule.bonds || [],
                    metadata: {
                        ...fileData.molecule.metadata,
                        name: fileData.name || presetName.replace('.mol.json', '').replace('.crystal.json', ''),
                        source: 'preset'
                    },
                    centerOfMass: calculateCenterOfMass(fileData.molecule.atoms || [], elements)
                };

                // Recalculate formula and mass
                loadedMolecule.metadata.formula = calculateMolecularFormula(loadedMolecule.atoms, elements);
                loadedMolecule.metadata.molecularMass = calculateMolecularMass(loadedMolecule.atoms, elements);

                setMolecule(loadedMolecule);
                setSelectedAtomId(null);
                setSelectedBondId(null);
                console.log('[MoleculeBuilder] Loaded molecule:', loadedMolecule.metadata.name, 'with', loadedMolecule.atoms.length, 'atoms');

                // Emit structure-loaded event for DualLLM feedback
                const EventBus = (window as any).EventBus;
                if (EventBus) {
                    const eventBus = EventBus.getInstance();
                    eventBus.emit('molecule:structure-loaded', {
                        source: 'preset',
                        name: presetName,
                        structure: {
                            atoms: loadedMolecule.atoms,
                            bonds: loadedMolecule.bonds,
                            metadata: loadedMolecule.metadata
                        }
                    });
                }
            }

            if (fileData.crystal) {
                setCrystal(fileData.crystal);
                setShowUnitCell(true);

                // Generate atoms from crystal structure if no molecule data
                if (!fileData.molecule && fileData.crystal.motifAtoms) {
                    const crystalData = fileData.crystal;
                    const { params, motifAtoms, tiling } = crystalData;
                    const generatedAtoms: MoleculeAtom[] = [];

                    // Calculate unit cell vectors
                    const [va, vb, vc] = calculateUnitCellVectors(params);

                    // Tile the unit cell
                    const nx = tiling?.nx || 1;
                    const ny = tiling?.ny || 1;
                    const nz = tiling?.nz || 1;

                    for (let ix = 0; ix < nx; ix++) {
                        for (let iy = 0; iy < ny; iy++) {
                            for (let iz = 0; iz < nz; iz++) {
                                motifAtoms.forEach((motifAtom: any) => {
                                    // Convert fractional coordinates to Cartesian
                                    const fx = motifAtom.position.x;
                                    const fy = motifAtom.position.y;
                                    const fz = motifAtom.position.z;

                                    // Position = fx*va + fy*vb + fz*vc + cell offset
                                    const x = (fx + ix) * va.x + (fy + iy) * vb.x + (fz + iz) * vc.x;
                                    const y = (fx + ix) * va.y + (fy + iy) * vb.y + (fz + iz) * vc.y;
                                    const z = (fx + ix) * va.z + (fy + iy) * vb.z + (fz + iz) * vc.z;

                                    generatedAtoms.push({
                                        id: `${motifAtom.id}_${ix}_${iy}_${iz}`,
                                        elementNumber: motifAtom.elementNumber,
                                        position: { x, y, z },
                                        hybridization: motifAtom.hybridization || 'none',
                                        formalCharge: motifAtom.formalCharge || 0,
                                        lonePairs: motifAtom.lonePairs || 0,
                                        bondedAtomIds: []
                                    });
                                });
                            }
                        }
                    }

                    const crystalMolecule: Molecule = {
                        atoms: generatedAtoms,
                        bonds: [], // Crystal structures typically don't have explicit bonds in this representation
                        metadata: {
                            name: fileData.name || presetName.replace('.crystal.json', ''),
                            formula: fileData.metadata?.formula || '',
                            molecularMass: 0,
                            source: 'preset',
                            createdAt: new Date().toISOString(),
                            modifiedAt: new Date().toISOString()
                        },
                        centerOfMass: calculateCenterOfMass(generatedAtoms, elements)
                    };

                    crystalMolecule.metadata.formula = calculateMolecularFormula(crystalMolecule.atoms, elements);
                    crystalMolecule.metadata.molecularMass = calculateMolecularMass(crystalMolecule.atoms, elements);

                    setMolecule(crystalMolecule);
                    console.log('[MoleculeBuilder] Generated crystal structure:', fileData.name, 'with', generatedAtoms.length, 'atoms');
                }
            } else {
                setCrystal(null);
            }
        } catch (error) {
            console.error('[MoleculeBuilder] Error loading preset:', error);
        }
    }, [elements]);

    // Listen for molecule:loading-preset events to trigger preset loading via EventBus
    useEffect(() => {
        const EventBus = (window as any).EventBus;
        if (!EventBus) return;

        const eventBus = EventBus.getInstance();

        const handleLoadingPreset = (data: { name: string }) => {
            if (data.name) {
                console.log('[MoleculeBuilder] Loading preset via EventBus:', data.name);
                handleLoadPreset(data.name);
            }
        };

        eventBus.on('molecule:loading-preset', handleLoadingPreset);

        return () => {
            eventBus.off('molecule:loading-preset', handleLoadingPreset);
        };
    }, [handleLoadPreset]);

    // Preset molecules list
    const presetMolecules = [
        { name: 'water.mol.json', label: 'H₂O (Water)' },
        { name: 'carbon-dioxide.mol.json', label: 'CO₂' },
        { name: 'methane.mol.json', label: 'CH₄ (Methane)' },
        { name: 'ammonia.mol.json', label: 'NH₃ (Ammonia)' },
        { name: 'ethene.mol.json', label: 'C₂H₄ (Ethene)' },
        { name: 'benzene.mol.json', label: 'C₆H₆ (Benzene)' }
    ];

    const presetCrystals = [
        { name: 'sodium-chloride.crystal.json', label: 'NaCl' },
        { name: 'diamond.crystal.json', label: 'Diamond' },
        { name: 'graphite.crystal.json', label: 'Graphite' },
        { name: 'ice-ih.crystal.json', label: 'Ice Ih' },
        { name: 'lithium-iron-phosphate.crystal.json', label: 'LiFePO₄ (Battery)' }
    ];

    // ================= CONDITIONAL RETURNS (after all hooks) =================
    // Show loading state
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-950 text-white">
                <div className="text-center">
                    <div className="text-6xl mb-4 animate-pulse">⚛️</div>
                    <h2 className="text-xl font-bold">Loading Periodic Table...</h2>
                    <p className="mt-2 text-slate-400">Fetching element data</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (loadError || !selectedElement) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-950 text-white">
                <div className="text-center max-w-md">
                    <div className="text-6xl mb-4">⚠️</div>
                    <h2 className="text-xl font-bold text-red-400">Failed to Load</h2>
                    <p className="mt-2 text-slate-400">{loadError || 'No elements loaded'}</p>
                    <p className="text-sm mt-4 text-slate-500">Make sure elements.json exists in the PeriodicTable folder.</p>
                </div>
            </div>
        );
    }

    if (viewMode === 'molecule-builder') {
        const selectedAtom = molecule.atoms.find(a => a.id === selectedAtomId);
        const selectedBond = molecule.bonds.find(b => b.id === selectedBondId);

        return (
            <div className="flex h-full overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
                {/* LEFT PANEL: Controls & Info */}
                <div className="min-w-[280px] w-[30%] flex flex-col border-r border-slate-700/50 bg-slate-900/80 backdrop-blur-xl">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                        <button
                            onClick={() => setViewMode('periodic-table')}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Back
                        </button>
                        <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                            Molecule Builder
                        </h2>
                    </div>

                    {/* Mode Selector */}
                    <div className="p-4 border-b border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Mode</div>
                        <div className="grid grid-cols-4 gap-1">
                            {(['select', 'add', 'bond', 'move'] as BuilderMode[]).map(mode => {
                                const icons: Record<BuilderMode, string> = {
                                    select: '👆',
                                    add: '➕',
                                    bond: '🔗',
                                    move: '✋'
                                };
                                return (
                                    <button
                                        key={mode}
                                        onClick={() => setBuilderMode(mode)}
                                        className={`px-2 py-2 rounded text-xs font-medium transition-all ${
                                            builderMode === mode
                                                ? 'bg-gradient-to-br from-cyan-600 to-cyan-500 text-white ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-900 shadow-lg shadow-cyan-500/30'
                                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex flex-col items-center gap-0.5">
                                            <span>{icons[mode]}</span>
                                            <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Element Palette */}
                    <div className="p-4 border-b border-slate-700/50">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-xs uppercase tracking-wider text-slate-400">
                                Element: <span className="font-bold text-cyan-400">{selectedElement?.symbol || 'None'}</span>
                            </div>
                            <button
                                onClick={() => setShowElementPicker(!showElementPicker)}
                                className="text-xs underline text-cyan-400 hover:text-cyan-300"
                            >
                                {showElementPicker ? 'Less' : 'All Elements'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {commonElements.map(el => (
                                <button
                                    key={el.number}
                                    onClick={() => selectElement(el)}
                                    className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-bold transition-all ${
                                        selectedElement?.number === el.number
                                            ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-900'
                                            : 'hover:scale-105'
                                    }`}
                                    style={{
                                        background: selectedElement?.number === el.number
                                            ? 'linear-gradient(135deg, #0891b2, #0e7490)'
                                            : `linear-gradient(135deg, ${CATEGORY_COLORS[el.category]?.from || '#475569'}, ${CATEGORY_COLORS[el.category]?.to || '#1e293b'})`
                                    }}
                                >
                                    <span className="text-sm">{el.symbol}</span>
                                    <span className="text-[8px] opacity-70">{el.number}</span>
                                </button>
                            ))}
                        </div>
                        {/* Full Element Picker */}
                        {showElementPicker && (
                            <div className="mt-3 p-2 rounded-lg max-h-48 overflow-y-auto bg-slate-800/50">
                                <div className="grid grid-cols-9 gap-0.5">
                                    {elements.map((el: ElementData) => (
                                        <button
                                            key={el.number}
                                            onClick={() => {
                                                selectElement(el);
                                                setShowElementPicker(false);
                                            }}
                                            className={`w-7 h-7 rounded flex flex-col items-center justify-center text-[10px] font-bold transition-all ${
                                                selectedElement?.number === el.number
                                                    ? 'ring-1 ring-cyan-400'
                                                    : 'hover:scale-110'
                                            }`}
                                            style={{
                                                background: `linear-gradient(135deg, ${CATEGORY_COLORS[el.category]?.from || '#475569'}, ${CATEGORY_COLORS[el.category]?.to || '#1e293b'})`
                                            }}
                                            title={`${el.name} (${el.symbol})`}
                                        >
                                            {el.symbol}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Bond Type Selector */}
                    <div className="p-4 border-b border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Bond Type</div>
                        <div className="grid grid-cols-3 gap-1">
                            {(['single', 'double', 'triple'] as BondType[]).map(type => (
                                <button
                                    key={type}
                                    onClick={() => setBondTypeToCreate(type)}
                                    className={`px-2 py-2 rounded text-xs font-medium transition-all ${
                                        bondTypeToCreate === type
                                            ? 'bg-gradient-to-br from-purple-600 to-violet-600 text-white ring-2 ring-purple-400 ring-offset-2 ring-offset-slate-900'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                                    }`}
                                >
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span>{type === 'single' ? '—' : type === 'double' ? '=' : '≡'}</span>
                                        <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Visualization Options */}
                    <div className="p-4 border-b border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Visualization</div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Show Electrons</span>
                            <button
                                onClick={() => setShowElectrons(!showElectrons)}
                                className={`w-12 h-6 rounded-full transition-colors relative ${showElectrons ? 'bg-cyan-600' : 'bg-slate-700'}`}
                            >
                                <div
                                    className={`absolute top-1 w-4 h-4 rounded-full transition-transform bg-white ${
                                        showElectrons ? 'left-7' : 'left-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Molecule Info */}
                    <div className="p-4 flex-1 overflow-y-auto border-b border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-3 text-slate-400">Molecule Info</div>
                        <div className="space-y-3">
                            <div className="rounded-lg p-3 bg-slate-800/50">
                                <div className="text-xs mb-1 text-slate-500">Formula</div>
                                <div className="text-xl font-mono font-bold text-cyan-300">
                                    {molecule.metadata.formula || '—'}
                                </div>
                            </div>
                            <div className="rounded-lg p-3 bg-slate-800/50">
                                <div className="text-xs mb-1 text-slate-500">Molecular Mass</div>
                                <div className="text-lg font-mono text-slate-200">
                                    {molecule.metadata.molecularMass > 0
                                        ? `${molecule.metadata.molecularMass.toFixed(3)} u`
                                        : '—'}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg p-2 text-center bg-slate-800/50">
                                    <div className="text-2xl font-bold text-green-400">{molecule.atoms.length}</div>
                                    <div className="text-[10px] uppercase text-slate-500">Atoms</div>
                                </div>
                                <div className="rounded-lg p-2 text-center bg-slate-800/50">
                                    <div className="text-2xl font-bold text-blue-400">{molecule.bonds.length}</div>
                                    <div className="text-[10px] uppercase text-slate-500">Bonds</div>
                                </div>
                            </div>
                        </div>

                        {/* Selected Item Info */}
                        {selectedAtom && (
                            <div className="mt-4 rounded-lg p-3 bg-cyan-950/30 border border-cyan-700/50">
                                <div className="text-xs uppercase tracking-wider mb-2 text-cyan-400">Selected Atom</div>
                                <div className="text-lg font-bold text-white">
                                    {elements.find(e => e.number === selectedAtom.elementNumber)?.name}
                                    <span className="ml-2 text-cyan-400">
                                        ({elements.find(e => e.number === selectedAtom.elementNumber)?.symbol})
                                    </span>
                                </div>
                                <div className="text-xs mt-1 text-slate-400">
                                    Bonds: {selectedAtom.bondedAtomIds.length} |
                                    Position: ({selectedAtom.position.x.toFixed(1)}, {selectedAtom.position.y.toFixed(1)}, {selectedAtom.position.z.toFixed(1)})
                                </div>
                            </div>
                        )}

                        {selectedBond && (
                            <div className="mt-4 rounded-lg p-3 bg-purple-950/30 border border-purple-700/50">
                                <div className="text-xs uppercase tracking-wider mb-2 text-purple-400">Selected Bond</div>
                                <div className="text-lg font-bold capitalize text-white">{selectedBond.type} Bond</div>
                                <div className="text-xs mt-1 text-slate-400">
                                    Polarity: {selectedBond.polarity.toFixed(2)} |
                                    {getBondCharacter(selectedBond.polarity)}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* File Actions */}
                    <div className="p-4 border-t border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">File</div>
                        <div className="flex gap-2 mb-3">
                            <button
                                onClick={handleSaveMolecule}
                                disabled={molecule.atoms.length === 0}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                                    molecule.atoms.length === 0
                                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                        : 'bg-green-600/80 text-white hover:bg-green-600'
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                </svg>
                                Save
                            </button>
                            <button
                                onClick={handleLoadMolecule}
                                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1 bg-blue-600/80 text-white hover:bg-blue-600"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Load
                            </button>
                        </div>

                        {/* Presets */}
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Presets</div>
                        <div className="grid grid-cols-2 gap-1 mb-2">
                            {presetMolecules.map(preset => (
                                <button
                                    key={preset.name}
                                    onClick={() => handleLoadPreset(preset.name)}
                                    className="px-2 py-1.5 rounded text-xs transition-colors truncate bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                                    title={preset.label}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1 mb-3">
                            {presetCrystals.map(preset => (
                                <button
                                    key={preset.name}
                                    onClick={() => handleLoadPreset(preset.name)}
                                    className="px-2 py-1.5 rounded text-xs transition-colors truncate bg-purple-900/50 text-purple-300 hover:bg-purple-800/50 hover:text-white"
                                    title={preset.label}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Edit Actions */}
                    <div className="p-4 border-t border-slate-700/50">
                        <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Edit</div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleDeleteSelected}
                                disabled={!selectedAtomId && !selectedBondId}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    (!selectedAtomId && !selectedBondId)
                                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                        : 'bg-red-600/80 text-white hover:bg-red-600'
                                }`}
                            >
                                Delete
                            </button>
                            <button
                                onClick={handleClearMolecule}
                                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-slate-700 text-white hover:bg-slate-600"
                            >
                                Clear All
                            </button>
                        </div>
                    </div>
                </div>

                {/* RIGHT PANEL: 3D Viewer */}
                <div className="flex-1 relative">
                    <MoleculeViewer3D
                        molecule={molecule}
                        crystal={crystal}
                        elements={elements}
                        selectedAtomId={selectedAtomId}
                        selectedBondId={selectedBondId}
                        builderMode={builderMode}
                        selectedElement={selectedElement}
                        bondTypeToCreate={bondTypeToCreate}
                        showUnitCell={showUnitCell}
                        showElectrons={showElectrons}
                        onAtomSelect={setSelectedAtomId}
                        onBondSelect={setSelectedBondId}
                        onAtomAdd={handleAtomAdd}
                        onAtomMove={handleAtomMove}
                        onBondCreate={handleBondCreate}
                    />

                    {/* Floating toolbar */}
                    <div className="absolute top-4 right-4 flex gap-2">
                        <button
                            onClick={() => setShowCrystalPanel(!showCrystalPanel)}
                            className={`p-2.5 rounded-lg transition-all shadow-lg text-white ${
                                showCrystalPanel
                                    ? 'bg-purple-600 border border-purple-400'
                                    : 'bg-slate-800/80 border border-slate-600 hover:bg-slate-700'
                            }`}
                            title="Crystal Builder"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                        </button>
                    </div>

                    {/* Crystal Panel (collapsible) */}
                    {showCrystalPanel && (
                        <div className="absolute top-16 right-4 w-72 rounded-xl shadow-2xl p-4 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50">
                            <div className="text-sm font-bold mb-3 text-purple-400">Crystal Builder</div>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs block mb-1 text-slate-400">Crystal System</label>
                                    <select
                                        className="w-full rounded-lg px-3 py-2 text-sm bg-slate-800 border border-slate-600 text-white"
                                        value={crystal?.system || 'cubic'}
                                        onChange={(e) => {
                                            const system = e.target.value as CrystalSystem;
                                            setCrystal({
                                                system,
                                                params: { a: 3, b: 3, c: 3, alpha: 90, beta: 90, gamma: 90 },
                                                motifAtoms: [],
                                                tiling: { nx: 1, ny: 1, nz: 1 }
                                            });
                                        }}
                                    >
                                        {(['cubic', 'tetragonal', 'orthorhombic', 'hexagonal', 'trigonal', 'monoclinic', 'triclinic'] as CrystalSystem[]).map(sys => (
                                            <option key={sys} value={sys}>{sys.charAt(0).toUpperCase() + sys.slice(1)}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">Show Unit Cell</span>
                                    <button
                                        onClick={() => setShowUnitCell(!showUnitCell)}
                                        className={`w-10 h-5 rounded-full transition-colors ${showUnitCell ? 'bg-cyan-600' : 'bg-slate-700'}`}
                                    >
                                        <div
                                            className={`w-4 h-4 rounded-full transition-transform bg-white ${showUnitCell ? 'translate-x-5' : 'translate-x-0.5'}`}
                                        />
                                    </button>
                                </div>
                                {crystal && (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <label className="text-[10px] block text-slate-500">a (Å)</label>
                                            <input
                                                type="number"
                                                value={crystal.params.a}
                                                onChange={(e) => setCrystal(prev => prev ? { ...prev, params: { ...prev.params, a: parseFloat(e.target.value) || 1 } } : null)}
                                                className="w-full rounded px-2 py-1 text-xs bg-slate-800 border border-slate-600 text-white"
                                                step="0.1"
                                                min="0.1"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] block text-slate-500">b (Å)</label>
                                            <input
                                                type="number"
                                                value={crystal.params.b}
                                                onChange={(e) => setCrystal(prev => prev ? { ...prev, params: { ...prev.params, b: parseFloat(e.target.value) || 1 } } : null)}
                                                className="w-full rounded px-2 py-1 text-xs bg-slate-800 border border-slate-600 text-white"
                                                step="0.1"
                                                min="0.1"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] block text-slate-500">c (Å)</label>
                                            <input
                                                type="number"
                                                value={crystal.params.c}
                                                onChange={(e) => setCrystal(prev => prev ? { ...prev, params: { ...prev.params, c: parseFloat(e.target.value) || 1 } } : null)}
                                                className="w-full rounded px-2 py-1 text-xs bg-slate-800 border border-slate-600 text-white"
                                                step="0.1"
                                                min="0.1"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Instructions overlay */}
                    {molecule.atoms.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center rounded-2xl p-8 bg-slate-900/80 backdrop-blur border border-slate-700/50">
                                <div className="text-4xl mb-4">⚛️</div>
                                <h3 className="text-xl font-bold mb-2 text-white">Start Building</h3>
                                <p className="text-sm max-w-xs text-slate-400">
                                    Select an element from the palette, then click on the grid to add atoms.
                                    Use Bond mode to connect atoms.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden font-sans bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
            {/* LEFT PANEL: 3D VIEWER & INFO */}
            <div
                style={{
                    width: `${sidebarWidth}px`,
                    minWidth: '250px',
                    maxWidth: '50%'
                }}
                className="flex flex-col flex-shrink-0 z-10 shadow-2xl border-r border-slate-700/50 bg-slate-900/60 backdrop-blur-xl"
            >

                {/* 3D View */}
                <div
                    className="h-1/2 min-h-[400px] relative group bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
                    style={{ perspective: '1000px' }}
                >
                    <div className="absolute top-4 left-4 z-10 pointer-events-none">
                        <div className="text-8xl font-black bg-gradient-to-br from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent opacity-90 drop-shadow-2xl">
                            {selectedElement.symbol}
                        </div>
                        <div className="text-sm font-mono mt-2 pl-1 text-cyan-400">
                            Atomic Number <span className="text-xl font-bold text-white">{selectedElement.number}</span>
                        </div>
                    </div>

                    {/* Controls overlay */}
                    <div className="absolute top-4 right-4 z-[100] flex flex-col gap-2">
                        {/* Lock electrons button */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setElectronsLocked(!electronsLocked);
                            }}
                            className={`p-2.5 rounded-lg transition-all shadow-lg backdrop-blur-sm text-white z-[101] ${
                                electronsLocked
                                    ? 'bg-cyan-600 border border-cyan-400'
                                    : 'bg-slate-800/95 border border-slate-600 hover:bg-slate-700 hover:border-slate-500'
                            }`}
                            title={electronsLocked ? "Unlock electrons (resume animation)" : "Lock electrons (freeze orbits)"}
                        >
                            {electronsLocked ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                            )}
                        </button>

                        {/* Visualization mode toggle */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setVisualizationMode(visualizationMode === 'bohr' ? 'orbital' : 'bohr');
                            }}
                            className={`p-2.5 rounded-lg transition-all shadow-lg backdrop-blur-sm text-white z-[101] ${
                                visualizationMode === 'orbital'
                                    ? 'bg-purple-600 border border-purple-400'
                                    : 'bg-slate-800/95 border border-slate-600 hover:bg-slate-700 hover:border-slate-500'
                            }`}
                            title={visualizationMode === 'bohr' ? "Switch to orbital cloud view" : "Switch to Bohr model view"}
                        >
                            {visualizationMode === 'orbital' ? (
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="12" cy="12" r="8" opacity="0.3" />
                                    <circle cx="12" cy="12" r="5" opacity="0.5" />
                                    <circle cx="12" cy="12" r="2" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="3" strokeWidth={2} />
                                    <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} />
                                    <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} transform="rotate(60 12 12)" />
                                    <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} transform="rotate(120 12 12)" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Orbital visibility toggles - only show in orbital mode */}
                    {visualizationMode === 'orbital' && (
                        <div className="absolute top-40 right-4 z-20 flex flex-col gap-1 p-2 rounded-lg bg-slate-900/90 backdrop-blur border border-slate-700/50">
                            <div className="text-[10px] uppercase tracking-wider mb-1 text-center text-slate-400">Orbitals</div>
                            {[
                                { key: 's', color: '#ff6b6b', label: 's' },
                                { key: 'p', color: '#ffd93d', label: 'p' },
                                { key: 'd', color: '#6bcbff', label: 'd' },
                                { key: 'f', color: '#6bff8a', label: 'f' },
                            ].map(({ key, color, label }) => (
                                <button
                                    key={key}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOrbitalVisibility(prev => ({ ...prev, [key]: !prev[key as keyof OrbitalVisibility] }));
                                    }}
                                    className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-all ${
                                        orbitalVisibility[key as keyof OrbitalVisibility]
                                            ? 'bg-slate-700/80 text-white'
                                            : 'bg-slate-800/50 text-slate-500'
                                    }`}
                                    title={`Toggle ${label} orbital`}
                                >
                                    <div
                                        className={`w-3 h-3 rounded-full transition-opacity ${orbitalVisibility[key as keyof OrbitalVisibility] ? 'opacity-100' : 'opacity-30'}`}
                                        style={{ backgroundColor: color, boxShadow: orbitalVisibility[key as keyof OrbitalVisibility] ? `0 0 6px ${color}` : 'none' }}
                                    />
                                    <span className="font-mono font-bold">{label}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Expand button */}
                    <button
                        onClick={() => setIsExpanded(true)}
                        className="absolute bottom-4 right-4 z-20 p-3 rounded-xl transition-all group shadow-lg bg-slate-800/80 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:border-slate-500"
                        title="Expand 3D view"
                    >
                        <svg className="w-5 h-5 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                    </button>

                    {/* Mode indicator */}
                    <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
                        <span className="text-xs font-medium px-2 py-1 rounded bg-slate-800/80 text-slate-300">
                            {visualizationMode === 'bohr' ? 'Bohr Model' : 'Orbital Clouds'}
                        </span>
                    </div>

                    <AtomViewer
                        element={selectedElement}
                        electronsLocked={electronsLocked}
                        visualizationMode={visualizationMode}
                        orbitalVisibility={orbitalVisibility}
                    />
                </div>

                {/* Info Panel */}
                <div className="flex-1 p-6 overflow-y-auto border-t border-slate-700/50 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950">
                    <h2 className="text-4xl font-black mb-2 bg-gradient-to-r from-white to-cyan-300 bg-clip-text text-transparent">{selectedElement.name}</h2>

                    <div className="flex items-center gap-2 mb-6">
                        <div
                            className="h-4 w-4 rounded-full shadow-lg"
                            style={{
                                background: `linear-gradient(to bottom right, ${CATEGORY_COLORS[selectedElement.category]?.from || DEFAULT_COLOR.from
                                    }, ${CATEGORY_COLORS[selectedElement.category]?.to || DEFAULT_COLOR.to
                                    })`
                            }}
                        />
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-300">
                            {selectedElement.category}
                        </span>
                    </div>

                    <div className="space-y-6">
                        <p
                            className="leading-relaxed text-sm pl-4 italic"
                            style={{
                                color: '#cbd5e1',
                                borderLeft: '4px solid rgba(6, 182, 212, 0.5)'
                            }}
                        >
                            {selectedElement.summary}
                        </p>

                        {/* Particle Count */}
                        <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 rounded-2xl border border-slate-600/30 shadow-xl">
                            <div className="text-xs uppercase tracking-wider mb-2 text-slate-400">Subatomic Particles</div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <div className="text-xs mb-1 text-slate-500">Protons</div>
                                    <div className="text-lg font-bold text-red-400">{selectedElement.number}</div>
                                </div>
                                <div>
                                    <div className="text-xs mb-1 text-slate-500">Neutrons</div>
                                    <div className="text-lg font-bold text-blue-400">{Math.round(selectedElement.mass - selectedElement.number)}</div>
                                </div>
                                <div>
                                    <div className="text-xs mb-1 text-slate-500">Electrons</div>
                                    <div className="text-lg font-bold text-green-400">{selectedElement.number}</div>
                                </div>
                            </div>
                        </div>

                        {selectedElement.electronConfig && (
                            <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-4 rounded-2xl border border-indigo-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Electron Configuration</div>
                                <div className="text-xl font-mono font-bold text-indigo-300">{selectedElement.electronConfig}</div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 rounded-2xl border border-slate-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Atomic Mass</div>
                                <div className="text-2xl font-mono font-bold text-cyan-300">{selectedElement.mass} <span className="text-sm text-slate-500">u</span></div>
                            </div>
                            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 rounded-2xl border border-slate-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Period / Group</div>
                                <div className="text-2xl font-mono font-bold text-purple-300">{selectedElement.ypos} <span className="text-slate-500">/</span> {selectedElement.xpos}</div>
                            </div>
                        </div>

                        {selectedElement.abundance && (
                            <div className="bg-gradient-to-br from-emerald-900/40 to-teal-900/40 p-4 rounded-2xl border border-emerald-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Abundance (Earth's Crust)</div>
                                <div className="text-xl font-mono font-bold text-emerald-300">{selectedElement.abundance}</div>
                            </div>
                        )}

                        {(selectedElement.meltingPoint !== undefined || selectedElement.boilingPoint !== undefined) && (
                            <div className="grid grid-cols-2 gap-4">
                                {selectedElement.meltingPoint !== undefined && (
                                    <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 rounded-2xl border border-slate-600/30 shadow-xl">
                                        <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Melting Point</div>
                                        <div className="text-lg font-mono font-bold text-orange-300">{selectedElement.meltingPoint}°C</div>
                                    </div>
                                )}
                                {selectedElement.boilingPoint !== undefined && (
                                    <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 rounded-2xl border border-slate-600/30 shadow-xl">
                                        <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Boiling Point</div>
                                        <div className="text-lg font-mono font-bold text-blue-300">{selectedElement.boilingPoint}°C</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedElement.discoveryYear && (
                            <div className="bg-gradient-to-br from-amber-900/40 to-yellow-900/40 p-4 rounded-2xl border border-amber-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-1 text-slate-400">Discovered</div>
                                <div className="text-xl font-bold text-yellow-300">{selectedElement.discoveryYear < 0 ? `${Math.abs(selectedElement.discoveryYear)} BCE` : selectedElement.discoveryYear}</div>
                            </div>
                        )}

                        {selectedElement.funFact && (
                            <div className="bg-gradient-to-br from-pink-900/40 to-rose-900/40 p-4 rounded-2xl border border-pink-600/30 shadow-xl">
                                <div className="text-xs uppercase tracking-wider mb-2 flex items-center gap-1 text-pink-300">
                                    Fun Fact
                                </div>
                                <div className="text-sm leading-relaxed italic text-slate-300">{selectedElement.funFact}</div>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* RESIZE HANDLE */}
            <div
                className="w-1.5 flex-shrink-0 cursor-col-resize transition-colors relative group bg-slate-700/30 hover:bg-cyan-500/50 active:bg-cyan-500"
                onMouseDown={(e) => {
                    handleSidebarResizeStart(e);
                }}
            >
                {/* Visual indicator on hover */}
                <div
                    className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-0.5 transition-colors bg-transparent"
                />
            </div>

            {/* RIGHT PANEL: PERIODIC TABLE */}
            <div className="flex-1 overflow-auto bg-slate-950">
                <div className="p-8 min-w-[1000px] relative">
                    {/* Subtle radial glow behind grid */}
                    <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            background: 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.08) 0%, transparent 60%)'
                        }}
                    />

                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <div className="flex items-center gap-4">
                            <h1 className="text-3xl font-black flex items-center gap-4">
                                <span className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-purple-600 flex items-center justify-center text-sm font-black shadow-2xl shadow-cyan-500/30">Pt</span>
                                <span className="bg-gradient-to-r from-white via-cyan-200 to-blue-300 bg-clip-text text-transparent">
                                    Periodic Table of Elements
                                </span>
                            </h1>
                            {/* Molecule Builder Button */}
                            <button
                                onClick={() => setViewMode('molecule-builder')}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium text-sm shadow-lg shadow-purple-500/25 transition-all hover:scale-105"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <circle cx="8" cy="8" r="3" strokeWidth={2} />
                                    <circle cx="16" cy="16" r="3" strokeWidth={2} />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 10.5L13.5 13.5" />
                                </svg>
                                Molecule Builder
                            </button>
                        </div>

                        {/* Legend - show all categories with proper colors */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 max-w-2xl justify-end">
                            {legendItems.map((item) => (
                                <div key={item.category} className="flex items-center gap-1.5 text-xs">
                                    <div
                                        className="h-3 w-3 rounded shadow-md"
                                        style={{
                                            background: `linear-gradient(to bottom right, ${item.color.from}, ${item.color.to})`
                                        }}
                                    />
                                    <span className="capitalize text-[10px] text-slate-400">{item.category}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="relative grid grid-cols-[repeat(18,minmax(0,1fr))] gap-1 p-5">
                        {/* Render Cells */}
                        {elements.map((el) => {
                            const col = el.xpos;
                            const row = el.ypos;
                            const isSelected = selectedElement.number === el.number;
                            const colVar = CATEGORY_COLORS[el.category] || DEFAULT_COLOR;

                            return (
                                <button
                                    key={el.number}
                                    onClick={() => selectElement(el)}
                                    style={{
                                        gridColumn: col,
                                        gridRow: row,
                                        aspectRatio: '1/1',
                                        border: isSelected ? '2px solid #22d3ee' : '2px solid rgba(51, 65, 85, 0.4)',
                                        boxShadow: isSelected
                                            ? `0 0 20px ${colVar.from}, 0 0 40px ${colVar.from}40, 0 0 0 4px rgba(34, 211, 238, 0.5)`
                                            : `0 0 8px ${colVar.from}25`,
                                    }}
                                    className={`
                                        relative group transition-all duration-300 transform
                                        flex flex-col justify-between p-1.5 rounded-xl
                                        ${isSelected
                                            ? 'scale-110 z-20'
                                            : 'hover:scale-105 hover:z-10'
                                        }
                                        overflow-hidden
                                    `}
                                >
                                    {/* Background with vibrant color coding */}
                                    <div
                                        className="absolute inset-0 opacity-100 transition-all duration-300"
                                        style={{
                                            background: `linear-gradient(to bottom right, ${colVar.from}, ${colVar.via}, ${colVar.to})`
                                        }}
                                    />

                                    {/* Shine effect */}
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                    <span className="relative z-10 text-[9px] font-mono font-bold leading-none text-white">
                                        {el.number}
                                    </span>

                                    <span className="relative z-10 text-lg font-black leading-none self-center drop-shadow-lg text-white">
                                        {el.symbol}
                                    </span>

                                    {/* Element name - ALWAYS visible now */}
                                    <span className="relative z-10 text-[8px] opacity-90 truncate w-full text-center font-medium leading-tight text-white">
                                        {el.name}
                                    </span>
                                </button>
                            );
                        })}

                        {/* Decorative Background Text */}
                        <div style={{ gridColumn: '3 / span 12', gridRow: '1 / span 4' }} className="pointer-events-none flex flex-col justify-center items-center opacity-[0.03] select-none">
                            <div className="text-[140px] font-black text-white tracking-tighter uppercase leading-none text-center">
                                Periodic<br />Table
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* Expanded 3D Modal */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-8"
                    style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        backdropFilter: 'blur(4px)'
                    }}
                    onClick={() => setIsExpanded(false)}
                >
                    <div
                        className="relative w-full max-w-6xl h-5/6 rounded-2xl shadow-2xl overflow-hidden"
                        style={{
                            background: 'linear-gradient(to bottom right, #0f172a, #1e293b, #0f172a)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-colors group bg-slate-800/80 border border-slate-600 text-slate-300 hover:bg-slate-700"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {/* Controls in modal */}
                        <div className="absolute top-4 right-20 z-[100] flex gap-2">
                            <button
                                onClick={() => setElectronsLocked(!electronsLocked)}
                                className={`p-2.5 rounded-lg transition-all shadow-lg text-white backdrop-blur-lg z-[101] ${
                                    electronsLocked
                                        ? 'bg-cyan-600 border border-cyan-400'
                                        : 'bg-slate-800/95 border border-slate-600 hover:bg-slate-700'
                                }`}
                                title={electronsLocked ? "Unlock electrons" : "Lock electrons"}
                            >
                                {electronsLocked ? (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={() => setVisualizationMode(visualizationMode === 'bohr' ? 'orbital' : 'bohr')}
                                className={`p-2.5 rounded-lg transition-all shadow-lg text-white backdrop-blur-lg z-[101] ${
                                    visualizationMode === 'orbital'
                                        ? 'bg-purple-600 border border-purple-400'
                                        : 'bg-slate-800/95 border border-slate-600 hover:bg-slate-700'
                                }`}
                                title={visualizationMode === 'bohr' ? "Switch to orbital clouds" : "Switch to Bohr model"}
                            >
                                {visualizationMode === 'orbital' ? (
                                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="12" r="8" opacity="0.3" />
                                        <circle cx="12" cy="12" r="5" opacity="0.5" />
                                        <circle cx="12" cy="12" r="2" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="3" strokeWidth={2} />
                                        <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} />
                                    </svg>
                                )}
                            </button>
                        </div>

                        {/* Element info overlay */}
                        <div className="absolute top-4 left-4 z-10 pointer-events-none">
                            <div className="text-9xl font-black bg-gradient-to-br from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent opacity-90 drop-shadow-2xl">
                                {selectedElement.symbol}
                            </div>
                            <div className="text-lg font-mono mt-2 pl-1 text-cyan-400">
                                <span className="text-sm">Atomic Number</span> <span className="text-2xl font-bold text-white">{selectedElement.number}</span>
                            </div>
                            <div className="text-2xl font-bold mt-2 text-white">
                                {selectedElement.name}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <div
                                    className="h-3 w-3 rounded-full shadow-lg"
                                    style={{
                                        background: `linear-gradient(to bottom right, ${CATEGORY_COLORS[selectedElement.category]?.from || DEFAULT_COLOR.from
                                            }, ${CATEGORY_COLORS[selectedElement.category]?.to || DEFAULT_COLOR.to
                                            })`
                                    }}
                                />
                                <span className="text-xs font-bold uppercase tracking-widest text-slate-300">
                                    {selectedElement.category}
                                </span>
                            </div>
                            <div className="mt-3 text-xs text-slate-400">
                                {visualizationMode === 'bohr' ? 'Bohr Model' : 'Orbital Cloud Model'}
                            </div>
                        </div>

                        {/* Expanded 3D View */}
                        <AtomViewer
                            element={selectedElement}
                            electronsLocked={electronsLocked}
                            visualizationMode={visualizationMode}
                            orbitalVisibility={orbitalVisibility}
                        />

                        {/* Orbital visibility toggles in expanded view - only show in orbital mode */}
                        {visualizationMode === 'orbital' && (
                            <div
                                className="absolute top-32 right-4 z-20 flex flex-col gap-1 p-3 rounded-lg"
                                style={{
                                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                    backdropFilter: 'blur(4px)',
                                    border: '1px solid rgba(51, 65, 85, 0.5)'
                                }}
                            >
                                <div className="text-xs uppercase tracking-wider mb-2 text-center text-slate-400">Orbital Visibility</div>
                                {[
                                    { key: 's', color: '#ff6b6b', label: 's orbital' },
                                    { key: 'p', color: '#ffd93d', label: 'p orbital' },
                                    { key: 'd', color: '#6bcbff', label: 'd orbital' },
                                    { key: 'f', color: '#6bff8a', label: 'f orbital' },
                                ].map(({ key, color, label }) => (
                                    <button
                                        key={key}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOrbitalVisibility(prev => ({ ...prev, [key]: !prev[key as keyof OrbitalVisibility] }));
                                        }}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
                                        style={{
                                            backgroundColor: orbitalVisibility[key as keyof OrbitalVisibility] ? 'rgba(51, 65, 85, 0.8)' : 'rgba(30, 41, 59, 0.5)',
                                            color: orbitalVisibility[key as keyof OrbitalVisibility] ? '#ffffff' : '#64748b'
                                        }}
                                        title={`Toggle ${label}`}
                                    >
                                        <div
                                            className={`w-4 h-4 rounded-full transition-opacity ${orbitalVisibility[key as keyof OrbitalVisibility] ? 'opacity-100' : 'opacity-30'}`}
                                            style={{ backgroundColor: color, boxShadow: orbitalVisibility[key as keyof OrbitalVisibility] ? `0 0 8px ${color}` : 'none' }}
                                        />
                                        <span className="font-medium">{label}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Instructions */}
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 text-sm pointer-events-none text-slate-400">
                            Click outside to close • Drag to rotate • Scroll to zoom
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
