import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ================= THEME =================

const THEME = {
    bg: {
        primary: '#0a0a0c',
        secondary: '#0f0f12',
        tertiary: '#16161a',
        elevated: '#1c1c22',
        hover: '#24242c',
    },
    border: {
        subtle: '#2a2a35',
        default: '#35354a',
        focus: '#4a9eff',
    },
    text: {
        primary: '#e8e8ed',
        secondary: '#9898a8',
        muted: '#606070',
    },
    accent: {
        primary: '#4a9eff',
        primaryHover: '#6bb0ff',
        primaryMuted: '#4a9eff20',
    },
    semantic: {
        success: '#3ecf8e',
        successMuted: '#3ecf8e15',
        warning: '#f5a623',
        warningMuted: '#f5a62315',
        error: '#ef5350',
        errorMuted: '#ef535015',
    },
    message: {
        user: '#1a2a40',
        userBorder: '#2a3a55',
        assistant: '#1a1a22',
        assistantBorder: '#2a2a35',
    },
    scrollbar: {
        track: '#16161a',
        thumb: '#35354a',
        thumbHover: '#45455a',
    },
    character: {
        male: '#3b82f6',
        female: '#e91e63',
    }
} as const;

// ================= TYPES =================

interface VramStats {
    total: number;
    free: number;
    allocated: number;
    used: number;
}

interface ServerStatus {
    model_ready: boolean;
    model_loading: boolean;
    model_name: string;
    cuda_available: boolean;
    vram: VramStats | null;
    error: string | null;
    chat_history_length: number;
}

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
}

type AnimationState = 'idle' | 'listening' | 'thinking' | 'talking';
type IdleAction = 'breathing' | 'lookAround' | 'shiftWeight' | 'checkHand';
type CharacterType = 'male' | 'female';

const RECOMMENDED_MODELS = [
    { label: 'Phi-3 Mini (3.8B)', value: 'microsoft/Phi-3-mini-4k-instruct', size: '~7GB' },
    { label: 'Phi-3 Small (7B)', value: 'microsoft/Phi-3-small-8k-instruct', size: '~14GB' },
    { label: 'Qwen2.5-7B Instruct', value: 'Qwen/Qwen2.5-7B-Instruct', size: '~14GB' },
    { label: 'Mistral-7B Instruct', value: 'mistralai/Mistral-7B-Instruct-v0.3', size: '~14GB' },
    { label: 'TinyLlama-1.1B', value: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', size: '~2GB' },
];

// Required Python packages for AnimatedCharacter Chat
const REQUIRED_PACKAGES = ['fastapi', 'uvicorn', 'torch', 'transformers', 'accelerate', 'huggingface-hub'];

// Packages that need special CUDA-enabled versions
const CUDA_PACKAGES: Record<string, {
    installCmd: string;
    checkCuda: (version: string) => boolean;
    getCudaVersion: (version: string) => string | null;
    requiredCudaVersion?: string;
}> = {
    'torch': {
        installCmd: 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124',
        checkCuda: (version: string) => version.includes('+cu'),
        getCudaVersion: (version: string): string | null => {
            const match = version.match(/\+cu(\d+)/);
            return match ? match[1] : null;
        },
        requiredCudaVersion: '124',
    },
};

// Helper to normalize package names for comparison
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/-/g, '_');

// Parse package info from pip freeze format
const parsePackageInfo = (pkgStr: string): { name: string; version?: string } => {
    if (pkgStr.includes(' @ ')) {
        const name = pkgStr.split(' @ ')[0].trim();
        return { name, version: 'local' };
    }
    if (pkgStr.includes('==')) {
        const [name, version] = pkgStr.split('==');
        return { name: name.trim(), version: version?.trim() };
    }
    return { name: pkgStr.trim() };
};

// Find installed package matching a required package name
const findInstalledPackage = (installedPackages: string[], requiredPkg: string): { found: boolean; version?: string } => {
    const requiredName = normalizePackageName(requiredPkg.replace(/[<>=!].*/g, ''));
    for (const pkgStr of installedPackages) {
        const parsed = parsePackageInfo(pkgStr);
        if (normalizePackageName(parsed.name) === requiredName) {
            return { found: true, version: parsed.version };
        }
    }
    return { found: false };
};

// Token limit constant
const MAX_TOKENS_LIMIT = 20000;

// ================= 3D CHARACTER COMPONENT =================

interface CharacterViewerProps {
    animationState: AnimationState;
    characterType: CharacterType;
}

const CharacterViewer: React.FC<CharacterViewerProps> = ({ animationState, characterType }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const animationIdRef = useRef<number>(0);

    // Character parts references
    const characterRef = useRef<THREE.Group | null>(null);
    const headRef = useRef<THREE.Group | null>(null);
    const leftArmRef = useRef<THREE.Group | null>(null);
    const rightArmRef = useRef<THREE.Group | null>(null);
    const leftForearmRef = useRef<THREE.Group | null>(null);
    const rightForearmRef = useRef<THREE.Group | null>(null);
    const mouthRef = useRef<THREE.Mesh | null>(null);
    const leftEyeRef = useRef<THREE.Mesh | null>(null);
    const rightEyeRef = useRef<THREE.Mesh | null>(null);

    // Animation state
    const animationTimeRef = useRef(0);
    const previousStateRef = useRef<AnimationState>('idle');
    const animationStateRef = useRef<AnimationState>(animationState);

    // Idle variation state
    const idleActionRef = useRef<IdleAction>('breathing');
    const idleTimerRef = useRef(0);
    const idleDurationRef = useRef(3); // Seconds until next action

    useEffect(() => {
        animationStateRef.current = animationState;
    }, [animationState]);

    // Initialize Scene
    useEffect(() => {
        if (!containerRef.current || !canvasRef.current) return;

        const container = containerRef.current;
        const canvas = canvasRef.current;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f1419);
        scene.fog = new THREE.FogExp2(0x0f1419, 0.02);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
        camera.position.set(0, 1, 8);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        rendererRef.current = renderer;

        // Controls
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.enablePan = false;
        controls.minDistance = 4;
        controls.maxDistance = 12;
        controls.maxPolarAngle = Math.PI / 2;
        controls.target.set(0, 1, 0);
        controlsRef.current = controls;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(5, 8, 5);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 1024;
        mainLight.shadow.mapSize.height = 1024;
        scene.add(mainLight);

        const fillLight = new THREE.PointLight(0x6699ff, 0.6);
        fillLight.position.set(-5, 3, -3);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0xff6699, 0.4);
        rimLight.position.set(0, 4, -5);
        scene.add(rimLight);

        // Create Character
        const character = new THREE.Group();
        characterRef.current = character;
        scene.add(character);

        // Character type specific settings
        const isFemale = characterType === 'female';

        // Materials - different colors for male/female
        const skinMat = new THREE.MeshPhongMaterial({
            color: isFemale ? 0xffe0bd : 0xffcc99,
            shininess: 30,
            flatShading: false
        });
        const clothMat = new THREE.MeshPhongMaterial({
            color: isFemale ? 0xe91e63 : 0x3b82f6, // Pink for female, blue for male
            shininess: 10
        });
        const eyeMat = new THREE.MeshPhongMaterial({
            color: 0x111111,
            shininess: 100
        });
        const mouthMat = new THREE.MeshPhongMaterial({
            color: isFemale ? 0xff4081 : 0xff6688,
            shininess: 20
        });
        const hairMat = new THREE.MeshPhongMaterial({
            color: isFemale ? 0x4a3728 : 0x3d2314, // Brown hair
            shininess: 20
        });

        // HEAD
        const head = new THREE.Group();
        headRef.current = head;
        head.position.y = isFemale ? 2.15 : 2.2; // Female slightly shorter
        character.add(head);

        const skull = new THREE.Mesh(
            new THREE.SphereGeometry(isFemale ? 0.38 : 0.4, 32, 32),
            skinMat
        );
        skull.castShadow = true;
        head.add(skull);

        // Hair for female character
        if (isFemale) {
            // Hair top - smaller cap that sits on top of head
            const hairTop = new THREE.Mesh(
                new THREE.SphereGeometry(0.39, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2.5),
                hairMat
            );
            hairTop.position.y = 0.08;
            hairTop.castShadow = true;
            head.add(hairTop);

            // Hair sides (ponytail style)
            const hairBack = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.08, 0.5, 16),
                hairMat
            );
            hairBack.position.set(0, 0.00, -0.35); // Raised much higher
            hairBack.rotation.x = 0.3;
            hairBack.castShadow = true;
            head.add(hairBack);

            // Hair bow
            const bowMat = new THREE.MeshPhongMaterial({
                color: 0xff69b4, // Hot pink bow
                shininess: 40
            });

            // Bow center knot - centered on head
            const bowKnot = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 16, 16),
                bowMat
            );
            bowKnot.position.set(0, 0.4, -0.2);
            bowKnot.castShadow = true;
            head.add(bowKnot);

            // Left bow loop
            const bowLeft = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 16, 16),
                bowMat
            );
            bowLeft.scale.set(1.2, 0.7, 0.5);
            bowLeft.position.set(-0.1, 0.43, -0.2);
            bowLeft.rotation.z = 0.4;
            bowLeft.castShadow = true;
            head.add(bowLeft);

            // Right bow loop
            const bowRight = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 16, 16),
                bowMat
            );
            bowRight.scale.set(1.2, 0.7, 0.5);
            bowRight.position.set(0.1, 0.43, -0.2);
            bowRight.rotation.z = -0.4;
            bowRight.castShadow = true;
            head.add(bowRight);

            // Bow ribbon tails
            const tailLeft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.015, 0.12, 8),
                bowMat
            );
            tailLeft.position.set(-0.05, 0.31, -0.2);
            tailLeft.rotation.z = 0.5;
            tailLeft.castShadow = true;
            head.add(tailLeft);

            const tailRight = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.015, 0.12, 8),
                bowMat
            );
            tailRight.position.set(0.05, 0.31, -0.2);
            tailRight.rotation.z = -0.5;
            tailRight.castShadow = true;
            head.add(tailRight);
        }

        // Eyes - slightly larger for female
        const eyeSize = isFemale ? 0.09 : 0.08;
        const leftEye = new THREE.Mesh(
            new THREE.SphereGeometry(eyeSize, 16, 16),
            eyeMat
        );
        leftEye.position.set(-0.12, 0.08, 0.32);
        leftEyeRef.current = leftEye;
        head.add(leftEye);

        const rightEye = new THREE.Mesh(
            new THREE.SphereGeometry(eyeSize, 16, 16),
            eyeMat
        );
        rightEye.position.set(0.12, 0.08, 0.32);
        rightEyeRef.current = rightEye;
        head.add(rightEye);

        // Eyelashes for female - positioned above eyes
        if (isFemale) {
            const lashMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const leftLash = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.02, 0.01),
                lashMat
            );
            leftLash.position.set(-0.12, 0.18, 0.38);
            head.add(leftLash);

            const rightLash = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.02, 0.01),
                lashMat
            );
            rightLash.position.set(0.12, 0.18, 0.38);
            head.add(rightLash);
        }

        // Mouth
        const mouth = new THREE.Mesh(
            new THREE.BoxGeometry(isFemale ? 0.18 : 0.2, 0.04, 0.05),
            mouthMat
        );
        mouth.position.set(0, -0.12, 0.36);
        mouthRef.current = mouth;
        head.add(mouth);

        // TORSO - different proportions for female
        const torso = new THREE.Mesh(
            new THREE.CylinderGeometry(
                isFemale ? 0.32 : 0.4,  // Top radius
                isFemale ? 0.28 : 0.35, // Bottom radius
                isFemale ? 0.9 : 1.0,   // Height
                32
            ),
            clothMat
        );
        torso.position.y = isFemale ? 1.2 : 1.2;
        torso.castShadow = true;
        character.add(torso);

        // Skirt for female
        if (isFemale) {
            const skirt = new THREE.Mesh(
                new THREE.CylinderGeometry(0.35, 0.45, 0.4, 32),
                clothMat
            );
            skirt.position.y = 0.75;
            skirt.castShadow = true;
            character.add(skirt);
        }

        // NECK - thinner for female
        const neck = new THREE.Mesh(
            new THREE.CylinderGeometry(
                isFemale ? 0.1 : 0.12,
                isFemale ? 0.12 : 0.15,
                0.3,
                16
            ),
            skinMat
        );
        neck.position.y = isFemale ? 1.8 : 1.85;
        neck.castShadow = true;
        character.add(neck);

        // ARM dimensions based on character type
        const armScale = isFemale ? 0.85 : 1.0;
        const shoulderY = isFemale ? 1.6 : 1.65;
        const shoulderX = isFemale ? 0.38 : 0.45;

        // LEFT ARM
        const leftArm = new THREE.Group();
        leftArmRef.current = leftArm;
        leftArm.position.set(-shoulderX, shoulderY, 0);
        character.add(leftArm);

        const leftUpperArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09 * armScale, 0.07 * armScale, 0.5 * armScale, 16),
            skinMat
        );
        leftUpperArm.position.y = -0.25 * armScale;
        leftUpperArm.castShadow = true;
        leftArm.add(leftUpperArm);

        // Left Forearm Pivot Group (Elbow)
        const leftForearmGroup = new THREE.Group();
        leftForearmGroup.position.y = -0.5 * armScale;
        leftForearmRef.current = leftForearmGroup;
        leftArm.add(leftForearmGroup);

        const leftForearm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07 * armScale, 0.055 * armScale, 0.42 * armScale, 16),
            skinMat
        );
        leftForearm.position.y = -0.21 * armScale;
        leftForearm.castShadow = true;
        leftForearmGroup.add(leftForearm);

        const leftHand = new THREE.Mesh(
            new THREE.SphereGeometry(0.07 * armScale, 16, 16),
            skinMat
        );
        leftHand.position.y = -0.46 * armScale;
        leftHand.castShadow = true;
        leftForearmGroup.add(leftHand);

        // RIGHT ARM
        const rightArm = new THREE.Group();
        rightArmRef.current = rightArm;
        rightArm.position.set(shoulderX, shoulderY, 0);
        character.add(rightArm);

        const rightUpperArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09 * armScale, 0.07 * armScale, 0.5 * armScale, 16),
            skinMat
        );
        rightUpperArm.position.y = -0.25 * armScale;
        rightUpperArm.castShadow = true;
        rightArm.add(rightUpperArm);

        // Right Forearm Pivot Group (Elbow)
        const rightForearmGroup = new THREE.Group();
        rightForearmGroup.position.y = -0.5 * armScale;
        rightForearmRef.current = rightForearmGroup;
        rightArm.add(rightForearmGroup);

        const rightForearm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07 * armScale, 0.055 * armScale, 0.42 * armScale, 16),
            skinMat
        );
        rightForearm.position.y = -0.21 * armScale;
        rightForearm.castShadow = true;
        rightForearmGroup.add(rightForearm);

        const rightHand = new THREE.Mesh(
            new THREE.SphereGeometry(0.07 * armScale, 16, 16),
            skinMat
        );
        rightHand.position.y = -0.46 * armScale;
        rightHand.castShadow = true;
        rightForearmGroup.add(rightHand);

        // LEGS
        const leftLeg = new THREE.Group();
        leftLeg.position.set(-0.2, 0.7, 0);
        character.add(leftLeg);

        const leftThigh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.1, 0.7, 16),
            clothMat
        );
        leftThigh.position.y = -0.35;
        leftThigh.castShadow = true;
        leftLeg.add(leftThigh);

        const leftShin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.08, 0.6, 16),
            skinMat
        );
        leftShin.position.y = -1.0;
        leftShin.castShadow = true;
        leftLeg.add(leftShin);

        const leftFoot = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.08, 0.25),
            clothMat
        );
        leftFoot.position.set(0, -1.35, 0.05);
        leftFoot.castShadow = true;
        leftLeg.add(leftFoot);

        const rightLeg = new THREE.Group();
        rightLeg.position.set(0.2, 0.7, 0);
        character.add(rightLeg);

        const rightThigh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.1, 0.7, 16),
            clothMat
        );
        rightThigh.position.y = -0.35;
        rightThigh.castShadow = true;
        rightLeg.add(rightThigh);

        const rightShin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.08, 0.6, 16),
            skinMat
        );
        rightShin.position.y = -1.0;
        rightShin.castShadow = true;
        rightLeg.add(rightShin);

        const rightFoot = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.08, 0.25),
            clothMat
        );
        rightFoot.position.set(0, -1.35, 0.05);
        rightFoot.castShadow = true;
        rightLeg.add(rightFoot);

        // Ground plane
        const groundGeo = new THREE.PlaneGeometry(20, 20);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Animation Loop
        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            animationTimeRef.current += 0.016; // ~60 FPS

            if (characterRef.current && headRef.current) {
                updateCharacterAnimation(animationStateRef.current);
            }

            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Resize handling
        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            if (width === 0 || height === 0) return;

            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(animationIdRef.current);
            if (rendererRef.current) {
                rendererRef.current.dispose();
            }
        };
    }, [characterType]); // Rebuild character when type changes

    // Character animation logic
    const updateCharacterAnimation = useCallback((state: AnimationState) => {
        const time = animationTimeRef.current;
        const dt = 0.016; // Approx delta time
        const head = headRef.current;
        const leftArm = leftArmRef.current;
        const rightArm = rightArmRef.current;
        const leftForearm = leftForearmRef.current;
        const rightForearm = rightForearmRef.current;
        const mouth = mouthRef.current;
        const leftEye = leftEyeRef.current;
        const rightEye = rightEyeRef.current;

        if (!head || !leftArm || !rightArm || !leftForearm || !rightForearm || !mouth) return;

        // Helper for smooth interpolation (damped)
        const damp = (current: number, target: number, lambda: number = 5) => {
            return current + (target - current) * (1 - Math.exp(-lambda * dt));
        };

        const setRot = (obj: THREE.Object3D, x: number, y: number, z: number, speed: number = 5) => {
            obj.rotation.x = damp(obj.rotation.x, x, speed);
            obj.rotation.y = damp(obj.rotation.y, y, speed);
            obj.rotation.z = damp(obj.rotation.z, z, speed);
        };

        switch (state) {
            case 'idle':
                // Manage idle variations
                idleTimerRef.current += dt;
                if (idleTimerRef.current > idleDurationRef.current) {
                    idleTimerRef.current = 0;
                    idleDurationRef.current = 2 + Math.random() * 4; // Random duration 2-6s

                    const rand = Math.random();
                    if (rand < 0.6) idleActionRef.current = 'breathing';
                    else if (rand < 0.8) idleActionRef.current = 'lookAround';
                    else if (rand < 0.9) idleActionRef.current = 'shiftWeight';
                    else idleActionRef.current = 'checkHand';
                }

                // Base breathing (always present)
                const breath = Math.sin(time * 0.8) * 0.5 + 0.5; // 0 to 1

                // Head drift - gentle natural movement
                let targetHeadY = Math.sin(time * 0.2) * 0.03;
                let targetHeadX = Math.sin(time * 0.15) * 0.02;
                let targetHeadZ = 0;


                const armSway = Math.sin(time * 0.25) * 0.02;

                // Upper arms angled outward
                let targetLArmZ = -0.4 + armSway; // Left arm angled outward
                let targetLArmX = 0.0;
                let targetLForeZ = 0.6 - breath * 0.1; // Elbow bends outward 

                let targetRArmZ = 0.4 - armSway; // Right arm angled outward
                let targetRArmX = 0.0;
                let targetRForeZ = -0.6 + breath * 0.1; // Elbow bends outward

                if (idleActionRef.current === 'lookAround') {
                    targetHeadY = Math.sin(time * 0.4) * 0.35; // Look left/right
                    targetHeadX = -0.05 + Math.sin(time * 0.25) * 0.1;
                } else if (idleActionRef.current === 'shiftWeight') {
                    // Subtle body sway - arms sway with body
                    targetHeadZ = Math.sin(time * 0.5) * 0.03;
                    targetLArmZ = -0.4 + Math.sin(time * 0.5) * 0.08;
                    targetRArmZ = 0.4 + Math.sin(time * 0.5) * 0.08;
                } else if (idleActionRef.current === 'checkHand') {
                    // Raise right hand to look at it
                    targetRArmX = -0.5;
                    targetRArmZ = 0.3;
                    targetRForeZ = -1.2; // Bend elbow more

                    targetHeadY = -0.25; // Look at right
                    targetHeadX = 0.15; // Look down
                }

                setRot(head, targetHeadX, targetHeadY, targetHeadZ, 2);
                setRot(leftArm, targetLArmX, 0, targetLArmZ, 2);
                setRot(leftForearm, 0, 0, targetLForeZ, 2);
                setRot(rightArm, targetRArmX, 0, targetRArmZ, 2);
                setRot(rightForearm, 0, 0, targetRForeZ, 2);

                // Slight mouth movement (breathing)
                mouth.scale.y = 0.8 + breath * 0.2;

                // Occasional blink
                const blinkPhase = (time * 0.5) % 4;
                const blinkScale = blinkPhase > 3.7 ? 0.1 : 1.0;
                if (leftEye && rightEye) {
                    leftEye.scale.y = damp(leftEye.scale.y, blinkScale, 25);
                    rightEye.scale.y = damp(rightEye.scale.y, blinkScale, 25);
                }
                break;

            case 'listening':
                // Attentive pose - slight head tilt, engaged body language
                {
                    const listenBreath = Math.sin(time * 0.6) * 0.5 + 0.5;
                    setRot(head, 0.08 + Math.sin(time * 0.3) * 0.02, Math.sin(time * 0.15) * 0.03, 0.04, 3);

                    // Arms with bent elbows outward, attentive pose
                    setRot(leftArm, 0.0, 0, -0.4 - listenBreath * 0.02, 3);
                    setRot(leftForearm, 0, 0, 0.5, 3); // Bend outward
                    setRot(rightArm, 0.0, 0, 0.4 + listenBreath * 0.02, 3);
                    setRot(rightForearm, 0, 0, -0.5, 3); // Bend outward

                    mouth.scale.y = damp(mouth.scale.y, 0.6, 10);

                    // Attentive eyes - slightly wider
                    if (leftEye && rightEye) {
                        leftEye.scale.y = damp(leftEye.scale.y, 1.1, 5);
                        rightEye.scale.y = damp(rightEye.scale.y, 1.1, 5);
                    }
                }
                break;

            case 'thinking':
                // Hand to chin gesture (Right hand) - classic thinking pose
                {
                    const thinkTime = time * 0.5;
                    // Head looks up/left with subtle movement
                    setRot(head, -0.15 + Math.sin(thinkTime) * 0.03, 0.2 + Math.sin(thinkTime * 0.7) * 0.05, -0.05, 3);

                    // Left arm relaxed with bent elbow outward
                    setRot(leftArm, 0.0, 0, -0.4, 3);
                    setRot(leftForearm, 0, 0, 0.5, 3); // Bend outward

                    // Right arm to chin - thinking pose (arm raised, hand toward face)
                    setRot(rightArm, -0.8, 0.6, -0.3, 4); // Raise arm up and across body
                    setRot(rightForearm, -1.5, 0, 0, 4); // Bend elbow to bring hand to chin

                    mouth.scale.y = damp(mouth.scale.y, 0.4, 10); // Slightly pursed

                    // Eyes look up slightly
                    if (leftEye && rightEye) {
                        leftEye.position.y = damp(leftEye.position.y, 0.1, 5);
                        rightEye.position.y = damp(rightEye.position.y, 0.1, 5);
                    }
                }
                break;

            case 'talking':
                // Animated, expressive talking with natural gestures
                {
                    const talkTime = time;

                    // Head movement - nodding and turning while speaking
                    const headNod = Math.sin(talkTime * 2.5) * 0.04;
                    const headTurn = Math.sin(talkTime * 1.5) * 0.08;
                    const headTilt = Math.sin(talkTime * 1.8) * 0.03;
                    setRot(head, headNod, headTurn, headTilt, 6);

                    // Expressive arm gestures - alternating emphasis
                    const gesturePhase = (talkTime * 0.8) % (Math.PI * 4);
                    const leftEmphasis = Math.max(0, Math.sin(gesturePhase));
                    const rightEmphasis = Math.max(0, Math.sin(gesturePhase + Math.PI));

                    // Left Arm - gestures when emphasizing
                    // Upper arm: X = forward tilt, Z = outward spread
                    // Forearm: Z = elbow bend outward
                    const lArmRaise = -0.2 - leftEmphasis * 0.4; // Raise arm when emphasizing
                    const lArmSpread = -0.4 - leftEmphasis * 0.3; // Base outward + gesture
                    const lForearmBend = 0.5 + leftEmphasis * 0.4; // Bend outward more when gesturing
                    setRot(leftArm, lArmRaise, 0, lArmSpread, 5);
                    setRot(leftForearm, 0, 0, lForearmBend, 6);

                    // Right Arm - gestures when emphasizing
                    const rArmRaise = -0.2 - rightEmphasis * 0.4;
                    const rArmSpread = 0.4 + rightEmphasis * 0.3; // Base outward + gesture
                    const rForearmBend = -0.5 - rightEmphasis * 0.4; // Bend outward
                    setRot(rightArm, rArmRaise, 0, rArmSpread, 5);
                    setRot(rightForearm, 0, 0, rForearmBend, 6);

                    // Dynamic mouth movement for speech
                    const mouthBase = 0.4;
                    const mouthVariation = Math.abs(Math.sin(talkTime * 12)) * 0.4 +
                                          Math.abs(Math.sin(talkTime * 8.5)) * 0.3 +
                                          Math.abs(Math.sin(talkTime * 5)) * 0.2;
                    mouth.scale.y = damp(mouth.scale.y, mouthBase + mouthVariation, 25);
                    mouth.scale.x = damp(mouth.scale.x, 1 + mouthVariation * 0.3, 20);

                    // Eyes - occasional blink while talking
                    if (leftEye && rightEye) {
                        const talkBlink = ((talkTime * 0.3) % 2.5) > 2.3 ? 0.15 : 1.0;
                        leftEye.scale.y = damp(leftEye.scale.y, talkBlink, 30);
                        rightEye.scale.y = damp(rightEye.scale.y, talkBlink, 30);
                        // Reset eye position
                        leftEye.position.y = damp(leftEye.position.y, 0.08, 5);
                        rightEye.position.y = damp(rightEye.position.y, 0.08, 5);
                    }
                }
                break;
        }
    }, []);

    // Update animation when state changes
    useEffect(() => {
        if (previousStateRef.current !== animationState) {
            previousStateRef.current = animationState;
            animationTimeRef.current = 0; // Reset animation time for smooth transitions
        }
    }, [animationState]);

    return (
        <div ref={containerRef} className="w-full h-full relative">
            <canvas ref={canvasRef} className="w-full h-full" />

            {/* State indicator */}
            <div className="absolute top-4 right-4 px-4 py-2 bg-black/60 backdrop-blur-sm rounded-lg border border-cyan-500/30">
                <div className="text-xs text-cyan-400 font-mono">State: <span className="text-white font-bold">{animationState}</span></div>
            </div>
        </div>
    );
};

// ================= MAIN CHAT COMPONENT =================

export const AnimatedCharacterChatWindow: React.FC = () => {
    // Server connection
    const [serverPort, setServerPort] = useState(8766);
    const [serverRunning, setServerRunning] = useState(false);
    const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [availableVenvs, setAvailableVenvs] = useState<string[]>([]);
    const [selectedVenv, setSelectedVenv] = useState<string>(() => {
        try { return localStorage.getItem('animatedChar_selectedVenv') || ''; } catch { return ''; }
    });

    // Dependency checking state
    const [depsStatus, setDepsStatus] = useState<Record<string, { installed: boolean; version?: string; hasCuda?: boolean }>>({});
    const [checkingDeps, setCheckingDeps] = useState(false);
    const [installingDeps, setInstallingDeps] = useState(false);
    const [installingPackage, setInstallingPackage] = useState<string | null>(null);
    const [showDepsPanel, setShowDepsPanel] = useState(true);
    const [torchCudaAvailable, setTorchCudaAvailable] = useState<boolean | null>(null);

    // Model state
    const [selectedModel, setSelectedModel] = useState('microsoft/Phi-3-mini-4k-instruct');
    const [customModel, setCustomModel] = useState('');
    const [useCustomModel, setUseCustomModel] = useState(false);
    const [device, setDevice] = useState('auto');
    const [useFp16, setUseFp16] = useState(true);

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
    const [useHistory, setUseHistory] = useState(true);
    const [showSystemPrompt, setShowSystemPrompt] = useState(false);

    // Generation parameters
    const [temperature, setTemperature] = useState(0.7);
    const [maxNewTokens, setMaxNewTokens] = useState(512);
    const [topK, setTopK] = useState(50);
    const [topP, setTopP] = useState(0.9);

    // UI state
    const [generating, setGenerating] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [logPanelHeight, setLogPanelHeight] = useState(120);
    const [isResizingLogs, setIsResizingLogs] = useState(false);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Token tracking state
    const [totalTokensUsed, setTotalTokensUsed] = useState(0);
    const [lastTokensPerSec, setLastTokensPerSec] = useState<number | null>(null);
    const [lastGenerationTokens, setLastGenerationTokens] = useState<number | null>(null);

    // Animation state
    const [animationState, setAnimationState] = useState<AnimationState>('idle');
    const [characterType, setCharacterType] = useState<CharacterType>('male');
    const talkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Logs panel collapse state
    const [logsCollapsed, setLogsCollapsed] = useState(false);

    const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

    const addLog = useCallback((msg: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
    }, []);

    // Persist selected venv to localStorage
    useEffect(() => {
        if (selectedVenv) {
            try { localStorage.setItem('animatedChar_selectedVenv', selectedVenv); } catch {}
        }
    }, [selectedVenv]);

    // Automatically check dependencies when venv changes
    useEffect(() => {
        const autoCheckDeps = async () => {
            if (!selectedVenv || !ipcRenderer) return;

            setCheckingDeps(true);
            setTorchCudaAvailable(null);

            try {
                const vres = await ipcRenderer.invoke('python-list-venvs');
                if (vres.success) {
                    const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
                    if (v && Array.isArray(v.packages) && v.packages.length >= 0) {
                        const map: Record<string, any> = {};
                        for (const pkg of REQUIRED_PACKAGES) {
                            const result = findInstalledPackage(v.packages, pkg);
                            const version = result.version || '';
                            const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
                            map[pkg] = {
                                installed: result.found,
                                version: result.version,
                                hasCuda: cudaInfo ? cudaInfo.checkCuda(version) : undefined
                            };
                        }
                        setDepsStatus(map);

                        // Check if torch has CUDA support
                        const torchVersion = map['torch']?.version || '';
                        const torchHasCuda = CUDA_PACKAGES['torch'].checkCuda(torchVersion);
                        setTorchCudaAvailable(torchVersion ? torchHasCuda : null);
                    }
                }
            } catch (err) {
                console.error('Error checking dependencies:', err);
            } finally {
                setCheckingDeps(false);
            }
        };

        autoCheckDeps();
    }, [selectedVenv, ipcRenderer]);

    // Auto-scroll
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Listen for Python logs
    useEffect(() => {
        if (!ipcRenderer) return;

        const handlePythonLog = (_event: any, log: string) => {
            const trimmed = log.trim();
            if (trimmed.includes('GET /status') || trimmed.includes('GET /health')) {
                return;
            }
            addLog(`[Python] ${trimmed}`);
        };

        ipcRenderer.on('python-log', handlePythonLog);
        ipcRenderer.on('python-error', handlePythonLog);

        return () => {
            ipcRenderer.removeListener('python-log', handlePythonLog);
            ipcRenderer.removeListener('python-error', handlePythonLog);
        };
    }, [ipcRenderer, addLog]);

    // Load venvs
    useEffect(() => {
        const loadVenvs = async () => {
            if (!ipcRenderer) return;
            const result = await ipcRenderer.invoke('python-list-venvs');
            if (result.success && result.venvs.length > 0) {
                const names = result.venvs.map((v: any) => v.name);
                setAvailableVenvs(names);
                if (!selectedVenv) {
                    setSelectedVenv(names[0]);
                }
            }
        };
        loadVenvs();
    }, [ipcRenderer, selectedVenv]);

    const getServerUrl = () => `http://127.0.0.1:${serverPort}`;

    const checkServerStatus = useCallback(async () => {
        try {
            const res = await fetch(`${getServerUrl()}/status`);
            if (res.ok) {
                const status = await res.json();
                setServerStatus(status);
                setServerRunning(true);
                return true;
            }
        } catch {
            setServerRunning(false);
            setServerStatus(null);
        }
        return false;
    }, [serverPort]);

    // Poll server status
    useEffect(() => {
        const interval = setInterval(() => {
            if (serverRunning) {
                checkServerStatus();
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [serverRunning, checkServerStatus]);

    // Install a specific CUDA-enabled package
    const installCudaPackage = async (pkg: string) => {
        if (!ipcRenderer || !selectedVenv) return;

        const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
        if (!cudaInfo) {
            addLog(`No CUDA package info for ${pkg}`);
            return;
        }

        setInstallingPackage(pkg);
        addLog(`Installing ${pkg} with CUDA support...`);

        try {
            // Uninstall existing version first
            addLog(`Uninstalling existing ${pkg}...`);
            await ipcRenderer.invoke('python-uninstall-package', {
                venvName: selectedVenv,
                package: pkg.replace('>=', ' ').split(' ')[0],
            });

            // Install CUDA version
            addLog(`Installing ${cudaInfo.installCmd}...`);
            const result = await ipcRenderer.invoke('python-install-package', {
                venvName: selectedVenv,
                package: cudaInfo.installCmd,
            });

            if (result.success) {
                addLog(`${pkg} with CUDA installed successfully`);
            } else {
                addLog(`ERROR installing ${pkg}: ${result.error}`);
            }

            // Re-check deps
            const vres = await ipcRenderer.invoke('python-list-venvs');
            if (vres.success) {
                const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
                if (v && Array.isArray(v.packages)) {
                    const map: Record<string, any> = {};
                    for (const p of REQUIRED_PACKAGES) {
                        const result = findInstalledPackage(v.packages, p);
                        const version = result.version || '';
                        const cudaPkgInfo = CUDA_PACKAGES[p as keyof typeof CUDA_PACKAGES];
                        map[p] = {
                            installed: result.found,
                            version: result.version,
                            hasCuda: cudaPkgInfo ? cudaPkgInfo.checkCuda(version) : undefined
                        };
                    }
                    setDepsStatus(map);

                    const torchVersion = map['torch']?.version || '';
                    setTorchCudaAvailable(CUDA_PACKAGES['torch'].checkCuda(torchVersion));
                }
            }
        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
        } finally {
            setInstallingPackage(null);
        }
    };

    // Install missing dependencies
    const installMissingDeps = async () => {
        if (!ipcRenderer || !selectedVenv) return;

        const missing = REQUIRED_PACKAGES.filter(pkg => !depsStatus[pkg]?.installed);
        if (missing.length === 0) {
            addLog('All dependencies already installed');
            return;
        }

        setInstallingDeps(true);
        addLog(`Installing ${missing.length} packages: ${missing.join(', ')}...`);

        try {
            for (const pkg of missing) {
                addLog(`Installing ${pkg}...`);

                const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
                if (cudaInfo) {
                    addLog(`Installing ${pkg} with CUDA support...`);
                    const result = await ipcRenderer.invoke('python-install-package', {
                        venvName: selectedVenv,
                        package: cudaInfo.installCmd,
                    });

                    if (result.success) {
                        addLog(`${pkg} (CUDA) installed`);
                        setDepsStatus(prev => ({
                            ...prev,
                            [pkg]: { installed: true, version: undefined, hasCuda: true }
                        }));
                    } else {
                        addLog(`ERROR installing ${pkg}: ${result.error}`);
                    }
                    continue;
                }

                const result = await ipcRenderer.invoke('python-install-package', {
                    venvName: selectedVenv,
                    package: pkg,
                });

                if (result.success) {
                    addLog(`${pkg} installed`);
                    setDepsStatus(prev => ({
                        ...prev,
                        [pkg]: { installed: true, version: undefined }
                    }));
                } else {
                    addLog(`ERROR installing ${pkg}: ${result.error}`);
                }
            }

            addLog('Dependency installation complete');

            // Re-check all deps to get versions
            const vres = await ipcRenderer.invoke('python-list-venvs');
            if (vres.success) {
                const v = (vres.venvs || []).find((x: any) => x.name === selectedVenv);
                if (v && Array.isArray(v.packages)) {
                    const map: Record<string, any> = {};
                    for (const pkg of REQUIRED_PACKAGES) {
                        const result = findInstalledPackage(v.packages, pkg);
                        const version = result.version || '';
                        const cudaInfo = CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES];
                        map[pkg] = {
                            installed: result.found,
                            version: result.version,
                            hasCuda: cudaInfo ? cudaInfo.checkCuda(version) : undefined
                        };
                    }
                    setDepsStatus(map);

                    const torchVersion = map['torch']?.version || '';
                    setTorchCudaAvailable(CUDA_PACKAGES['torch'].checkCuda(torchVersion));
                }
            }
        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
        } finally {
            setInstallingDeps(false);
        }
    };

    const startServer = async () => {
        if (!ipcRenderer) {
            addLog('ERROR: Not running in Electron');
            return;
        }

        setConnecting(true);
        addLog('Starting Local LLM server...');

        const alreadyRunning = await checkServerStatus();
        if (alreadyRunning) {
            addLog('Server already running!');
            setConnecting(false);
            return;
        }

        if (!selectedVenv) {
            addLog('ERROR: No Python virtual environment selected.');
            setConnecting(false);
            return;
        }

        addLog(`Using venv: ${selectedVenv}`);

        // Get the script path from workflow folder (uses LocalChat's script)
        const scriptResult = await ipcRenderer.invoke('resolve-workflow-script', {
            workflowFolder: 'LocalChat',
            scriptName: 'local_llm_server.py'
        });

        if (!scriptResult.success) {
            addLog(`ERROR: Could not find local_llm_server.py: ${scriptResult.error}`);
            setConnecting(false);
            return;
        }

        const result = await ipcRenderer.invoke('python-start-script-server', {
            venvName: selectedVenv,
            scriptPath: scriptResult.path,
            port: serverPort,
            serverName: 'local_llm',
        });

        if (result.success) {
            addLog(`Server process started (PID: ${result.pid})`);

            let attempts = 0;
            const maxAttempts = 30;
            const pollInterval = setInterval(async () => {
                attempts++;
                const isReady = await checkServerStatus();
                if (isReady) {
                    clearInterval(pollInterval);
                    addLog('Server connected!');
                    setConnecting(false);
                } else if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    addLog('ERROR: Server failed to start within timeout.');
                    setConnecting(false);
                }
            }, 1000);
        } else {
            addLog(`ERROR: Failed to start server: ${result.error}`);
            setConnecting(false);
        }
    };

    const stopServer = async () => {
        if (!ipcRenderer) return;

        const result = await ipcRenderer.invoke('python-stop-script-server', 'local_llm');
        if (result.success) {
            addLog('Server stopped');
            setServerRunning(false);
            setServerStatus(null);
        } else {
            try {
                await fetch(`${getServerUrl()}/shutdown`, { method: 'POST' });
                addLog('Server shutdown requested');
            } catch {
                addLog('Server not responding');
            }
            setServerRunning(false);
            setServerStatus(null);
        }
        setAnimationState('idle');
    };

    const loadModel = async () => {
        if (!serverRunning) {
            addLog('ERROR: Server not running');
            return;
        }

        const modelToLoad = useCustomModel ? customModel : selectedModel;
        addLog(`Loading model: ${modelToLoad}...`);

        try {
            const res = await fetch(`${getServerUrl()}/load_model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_name: modelToLoad,
                    device,
                    use_fp16: useFp16,
                }),
            });

            const data = await res.json();
            if (data.success) {
                addLog(`Model loaded on ${data.device}: ${data.model_name}`);
                await checkServerStatus();
            } else {
                addLog(`ERROR: ${data.error}`);
            }
        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
        }
    };

    const unloadModel = async () => {
        if (!serverRunning) return;

        addLog('Unloading model...');
        try {
            const res = await fetch(`${getServerUrl()}/unload_model`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                addLog('Model unloaded');
                await checkServerStatus();
            }
        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
        }
        setAnimationState('idle');
    };

    const sendMessage = async () => {
        if (!serverRunning || !serverStatus?.model_ready || !inputMessage.trim()) {
            return;
        }

        // Check token limit
        if (totalTokensUsed >= MAX_TOKENS_LIMIT) {
            addLog('ERROR: Token limit reached. Clear history to continue.');
            return;
        }

        const userMessage = inputMessage.trim();
        setInputMessage('');
        setGenerating(true);
        setAnimationState('thinking');

        // Add user message
        const userMsg: ChatMessage = {
            role: 'user',
            content: userMessage,
            timestamp: new Date().toLocaleTimeString(),
        };
        setMessages(prev => [...prev, userMsg]);

        addLog(`Sending: "${userMessage.substring(0, 50)}..."`);

        // Create placeholder for streaming response
        const assistantMsgId = Date.now();
        const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toLocaleTimeString(),
        };
        setMessages(prev => [...prev, assistantMsg]);

        try {
            const res = await fetch(`${getServerUrl()}/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    temperature,
                    max_new_tokens: maxNewTokens,
                    top_k: topK,
                    top_p: topP,
                    system_prompt: showSystemPrompt ? systemPrompt : null,
                    use_history: useHistory,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP error: ${res.status}`);
            }

            const reader = res.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let streamedContent = '';
            let startedTalking = false;
            let tokenCount = 0;
            const startTime = Date.now();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'start') {
                                // Start talking animation when first token arrives
                                addLog('Streaming started...');
                            } else if (data.type === 'token' && data.content) {
                                streamedContent += data.content;
                                tokenCount++;

                                // Start talking animation on first real content
                                if (!startedTalking && streamedContent.trim().length > 0) {
                                    setAnimationState('talking');
                                    startedTalking = true;
                                }

                                // Update the assistant message in real-time
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const lastMsg = newMessages[newMessages.length - 1];
                                    if (lastMsg && lastMsg.role === 'assistant') {
                                        lastMsg.content = streamedContent;
                                    }
                                    return newMessages;
                                });
                            } else if (data.type === 'done') {
                                const elapsedSec = (Date.now() - startTime) / 1000;
                                const tokensPerSec = tokenCount / elapsedSec;

                                // Update token tracking
                                setLastGenerationTokens(tokenCount);
                                setLastTokensPerSec(tokensPerSec);
                                setTotalTokensUsed(prev => prev + tokenCount);

                                addLog(`Response: ${tokenCount} tokens in ${elapsedSec.toFixed(1)}s (${tokensPerSec.toFixed(1)} tok/s)`);

                                // Keep talking for a bit after completion, then return to idle
                                if (talkingTimeoutRef.current) {
                                    clearTimeout(talkingTimeoutRef.current);
                                }
                                talkingTimeoutRef.current = setTimeout(() => {
                                    setAnimationState('idle');
                                }, 1500); // Brief pause after finishing
                            } else if (data.type === 'error') {
                                addLog(`ERROR: ${data.error}`);
                                setAnimationState('idle');
                            } else if (data.error) {
                                addLog(`ERROR: ${data.error}`);
                                setAnimationState('idle');
                            }
                        } catch (parseError) {
                            // Ignore parse errors for incomplete JSON
                        }
                    }
                }
            }

            // If no content was received, clean up
            if (!streamedContent) {
                setMessages(prev => prev.slice(0, -1)); // Remove empty assistant message
                setAnimationState('idle');
            }

        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
            setAnimationState('idle');
            // Remove the empty assistant message on error
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
                    return prev.slice(0, -1);
                }
                return prev;
            });
        } finally {
            setGenerating(false);
        }
    };

    const clearHistory = async () => {
        if (!serverRunning) return;

        try {
            await fetch(`${getServerUrl()}/clear_history`, { method: 'POST' });
            setMessages([]);
            setTotalTokensUsed(0);
            setLastTokensPerSec(null);
            setLastGenerationTokens(null);
            addLog('Chat history cleared');
            setAnimationState('idle');
        } catch (e: any) {
            addLog(`ERROR: ${e.message}`);
        }
    };

    // Detect when user is typing
    useEffect(() => {
        if (inputMessage.trim().length > 0 && !generating) {
            setAnimationState('listening');
        } else if (!generating) {
            setAnimationState('idle');
        }
    }, [inputMessage, generating]);

    // Inject custom scrollbar styles
    useEffect(() => {
        const styleId = 'animated-character-scrollbar-styles';
        if (document.getElementById(styleId)) return;

        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            .animated-char-scroll::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            .animated-char-scroll::-webkit-scrollbar-track {
                background: ${THEME.scrollbar.track};
                border-radius: 4px;
            }
            .animated-char-scroll::-webkit-scrollbar-thumb {
                background: ${THEME.scrollbar.thumb};
                border-radius: 4px;
            }
            .animated-char-scroll::-webkit-scrollbar-thumb:hover {
                background: ${THEME.scrollbar.thumbHover};
            }
            .animated-char-scroll::-webkit-scrollbar-corner {
                background: ${THEME.scrollbar.track};
            }
            .animated-char-scroll {
                scrollbar-width: thin;
                scrollbar-color: ${THEME.scrollbar.thumb} ${THEME.scrollbar.track};
            }
        `;
        document.head.appendChild(styleEl);

        return () => {
            const el = document.getElementById(styleId);
            if (el) el.remove();
        };
    }, []);

    // Styles
    const sectionStyle: React.CSSProperties = {
        background: THEME.bg.tertiary,
        padding: '14px',
        borderRadius: '8px',
        marginBottom: '12px',
        border: `1px solid ${THEME.border.subtle}`,
    };

    const buttonStyle: React.CSSProperties = {
        padding: '8px 16px',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        background: THEME.accent.primary,
        color: '#ffffff',
        fontSize: '13px',
        fontWeight: 500,
        transition: 'opacity 0.15s ease',
    };

    const buttonSecondaryStyle: React.CSSProperties = {
        padding: '8px 16px',
        border: `1px solid ${THEME.border.default}`,
        borderRadius: '6px',
        cursor: 'pointer',
        background: THEME.bg.elevated,
        color: THEME.text.primary,
        fontSize: '13px',
        fontWeight: 500,
        transition: 'opacity 0.15s ease',
    };

    const inputStyle: React.CSSProperties = {
        padding: '8px 12px',
        border: `1px solid ${THEME.border.subtle}`,
        borderRadius: '6px',
        background: THEME.bg.elevated,
        color: THEME.text.primary,
        fontSize: '13px',
        width: '100%',
        outline: 'none',
    };

    const sliderContainerStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '10px',
    };

    const messageStyle = (role: string): React.CSSProperties => ({
        padding: '12px 16px',
        borderRadius: '10px',
        marginBottom: '10px',
        background: role === 'user' ? THEME.message.user : THEME.message.assistant,
        border: `1px solid ${role === 'user' ? THEME.message.userBorder : THEME.message.assistantBorder}`,
        color: THEME.text.primary,
        fontSize: '13px',
        lineHeight: '1.6',
    });

    return (
        <div style={{ display: 'flex', height: '100%', background: THEME.bg.primary, color: THEME.text.primary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>

            {/* LEFT: 3D Character */}
            <div style={{ width: '45%', minWidth: '400px', borderRight: `1px solid ${THEME.border.subtle}`, position: 'relative' }}>
                <CharacterViewer animationState={animationState} characterType={characterType} />

                {/* Character Switcher */}
                <div style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: '6px',
                    background: 'rgba(10, 10, 12, 0.85)',
                    padding: '6px',
                    borderRadius: '24px',
                    backdropFilter: 'blur(12px)',
                    border: `1px solid ${THEME.border.subtle}`,
                }}>
                    <button
                        onClick={() => setCharacterType('male')}
                        style={{
                            padding: '6px 16px',
                            border: 'none',
                            borderRadius: '18px',
                            cursor: 'pointer',
                            background: characterType === 'male' ? THEME.character.male : 'transparent',
                            color: characterType === 'male' ? '#ffffff' : THEME.text.secondary,
                            fontSize: '12px',
                            fontWeight: characterType === 'male' ? 600 : 400,
                            transition: 'all 0.15s ease',
                        }}
                    >
                        Male
                    </button>
                    <button
                        onClick={() => setCharacterType('female')}
                        style={{
                            padding: '6px 16px',
                            border: 'none',
                            borderRadius: '18px',
                            cursor: 'pointer',
                            background: characterType === 'female' ? THEME.character.female : 'transparent',
                            color: characterType === 'female' ? '#ffffff' : THEME.text.secondary,
                            fontSize: '12px',
                            fontWeight: characterType === 'female' ? 600 : 400,
                            transition: 'all 0.15s ease',
                        }}
                    >
                        Female
                    </button>
                </div>
            </div>

            {/* RIGHT: Chat Interface */}
            <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: THEME.bg.secondary }}>
                <h2 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600, color: THEME.text.primary, letterSpacing: '-0.01em' }}>AI Character Chat</h2>

                {/* Server Connection */}
                <div style={sectionStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', color: THEME.text.secondary }}>Venv:</span>
                        <select
                            value={selectedVenv}
                            onChange={e => setSelectedVenv(e.target.value)}
                            style={{ ...inputStyle, width: '130px' }}
                            disabled={serverRunning}
                        >
                            {availableVenvs.length === 0 ? (
                                <option value="">No venvs</option>
                            ) : (
                                availableVenvs.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))
                            )}
                        </select>
                        <span style={{ fontSize: '12px', color: THEME.text.secondary }}>Port:</span>
                        <input
                            type="number"
                            value={serverPort}
                            onChange={e => setServerPort(parseInt(e.target.value) || 8766)}
                            style={{ ...inputStyle, width: '70px' }}
                            disabled={serverRunning}
                        />
                        {!serverRunning ? (
                            <button onClick={startServer} disabled={connecting} style={{ ...buttonStyle, opacity: connecting ? 0.6 : 1 }}>
                                {connecting ? 'Connecting...' : 'Start Server'}
                            </button>
                        ) : (
                            <>
                                <span style={{
                                    color: THEME.semantic.success,
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}>
                                    <span style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: THEME.semantic.success,
                                    }} />
                                    Connected
                                </span>
                                <button onClick={stopServer} style={{ ...buttonSecondaryStyle, marginLeft: '8px', padding: '6px 12px' }}>
                                    Stop
                                </button>
                            </>
                        )}
                    </div>

                    {serverStatus && (
                        <div style={{ fontSize: '11px', color: THEME.text.muted }}>
                            <span>CUDA: {serverStatus.cuda_available ? 'Yes' : 'No'}</span>
                            {serverStatus.vram && (
                                <span style={{ marginLeft: '15px' }}>
                                    VRAM: {(serverStatus.vram.used / 1024 ** 3).toFixed(1)}GB / {(serverStatus.vram.total / 1024 ** 3).toFixed(1)}GB
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Dependencies Panel */}
                <div style={sectionStyle}>
                    <div
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                        onClick={() => setShowDepsPanel(!showDepsPanel)}
                    >
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: THEME.text.primary }}>Dependencies</h4>
                        <span style={{
                            fontSize: '10px',
                            color: THEME.text.muted,
                            transform: showDepsPanel ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 0.2s ease',
                            display: 'inline-block',
                        }}>▼</span>
                    </div>
                    {showDepsPanel && (
                        <div style={{ marginTop: '12px' }}>
                            {checkingDeps ? (
                                <div style={{ fontSize: '11px', color: THEME.text.muted }}>Checking dependencies...</div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                                        {REQUIRED_PACKAGES.map(pkg => {
                                            const status = depsStatus[pkg];
                                            const isCudaPkg = pkg in CUDA_PACKAGES;
                                            const cudaPkgConfig = isCudaPkg ? CUDA_PACKAGES[pkg as keyof typeof CUDA_PACKAGES] : null;
                                            const needsCudaWarning = isCudaPkg && status?.installed && status?.hasCuda === false;

                                            const installedVersion = status?.version || '';
                                            const cudaVersion = cudaPkgConfig?.getCudaVersion(installedVersion);
                                            const hasCudaVersionMismatch = cudaPkgConfig?.requiredCudaVersion && cudaVersion !== cudaPkgConfig.requiredCudaVersion;
                                            const hasAnyMismatch = hasCudaVersionMismatch || needsCudaWarning;

                                            // New simplified pill styling
                                            let bgColor = THEME.semantic.successMuted;
                                            let textColor = THEME.semantic.success;

                                            if (!status?.installed) {
                                                bgColor = THEME.semantic.errorMuted;
                                                textColor = THEME.semantic.error;
                                            } else if (hasAnyMismatch) {
                                                bgColor = THEME.semantic.warningMuted;
                                                textColor = THEME.semantic.warning;
                                            }

                                            let tooltip = '';
                                            if (hasCudaVersionMismatch) {
                                                tooltip = `CUDA version: have cu${cudaVersion || 'none'}, recommend cu${cudaPkgConfig?.requiredCudaVersion}`;
                                            } else if (needsCudaWarning) {
                                                tooltip = `${pkg} installed but no CUDA support - GPU acceleration disabled!`;
                                            }

                                            // Truncate version for cleaner display
                                            const displayVersion = status?.version ? status.version.split('+')[0] : '';

                                            return (
                                                <div
                                                    key={pkg}
                                                    title={tooltip || undefined}
                                                    style={{
                                                        padding: '4px 10px',
                                                        borderRadius: '12px',
                                                        fontSize: '11px',
                                                        fontWeight: 500,
                                                        background: bgColor,
                                                        color: textColor,
                                                    }}
                                                >
                                                    {pkg}
                                                    {displayVersion && (
                                                        <span style={{ opacity: 0.7, marginLeft: '4px' }}>
                                                            {displayVersion}
                                                        </span>
                                                    )}
                                                    {needsCudaWarning && ' ⚠'}
                                                    {!hasAnyMismatch && isCudaPkg && status?.hasCuda === true && ' ✓'}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* CUDA Status */}
                                    {torchCudaAvailable !== null && (
                                        <div style={{ fontSize: '11px', marginBottom: '10px', padding: '8px 12px', background: THEME.bg.elevated, borderRadius: '6px' }}>
                                            <span style={{ color: torchCudaAvailable ? THEME.semantic.success : THEME.semantic.warning }}>
                                                PyTorch CUDA: {torchCudaAvailable ? '✓ Available' : '✗ CPU only'}
                                            </span>
                                        </div>
                                    )}

                                    {/* PyTorch CUDA Warning + Install Button */}
                                    {depsStatus['torch']?.installed && depsStatus['torch']?.hasCuda === false && (
                                        <div style={{ fontSize: '11px', color: THEME.semantic.warning, marginBottom: '8px', padding: '10px 12px', background: THEME.semantic.warningMuted, borderRadius: '6px', border: `1px solid ${THEME.semantic.warning}20` }}>
                                            <div style={{ marginBottom: '8px' }}>
                                                ⚠ <strong>PyTorch has no CUDA support.</strong> Models will run on CPU (slower).
                                            </div>
                                            <button
                                                onClick={() => installCudaPackage('torch')}
                                                disabled={installingPackage !== null}
                                                style={{ ...buttonStyle, opacity: installingPackage === 'torch' ? 0.6 : 1, fontSize: '11px', padding: '6px 12px' }}
                                            >
                                                {installingPackage === 'torch' ? 'Installing...' : 'Install PyTorch with CUDA'}
                                            </button>
                                        </div>
                                    )}

                                    {/* Install Missing Dependencies Button */}
                                    {REQUIRED_PACKAGES.some(pkg => !depsStatus[pkg]?.installed) && (
                                        <button
                                            onClick={installMissingDeps}
                                            disabled={installingDeps || installingPackage !== null || !selectedVenv}
                                            style={{ ...buttonStyle, opacity: installingDeps ? 0.6 : 1, marginBottom: '8px', fontSize: '11px' }}
                                        >
                                            {installingDeps ? 'Installing...' : 'Install Missing Dependencies'}
                                        </button>
                                    )}

                                    {/* All deps installed */}
                                    {REQUIRED_PACKAGES.every(pkg => depsStatus[pkg]?.installed) && (
                                        <div style={{ fontSize: '11px', color: torchCudaAvailable ? THEME.semantic.success : THEME.semantic.warning }}>
                                            All dependencies installed {torchCudaAvailable ? '(CUDA ready)' : '(CPU mode)'}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Model Settings */}
                <div style={sectionStyle}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 500, color: THEME.text.primary }}>Model Settings</h4>

                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '8px', color: THEME.text.secondary, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={useCustomModel}
                                onChange={e => setUseCustomModel(e.target.checked)}
                                style={{ accentColor: THEME.accent.primary }}
                            />
                            Use custom model
                        </label>

                        {useCustomModel ? (
                            <input
                                type="text"
                                value={customModel}
                                onChange={e => setCustomModel(e.target.value)}
                                placeholder="e.g., microsoft/Phi-3-mini-4k-instruct"
                                style={inputStyle}
                            />
                        ) : (
                            <select
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                                style={inputStyle}
                            >
                                {RECOMMENDED_MODELS.map(model => (
                                    <option key={model.value} value={model.value}>
                                        {model.label} ({model.size})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                        <label style={{ fontSize: '12px', color: THEME.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={useFp16} onChange={e => setUseFp16(e.target.checked)} style={{ accentColor: THEME.accent.primary }} />
                            FP16
                        </label>
                        <input
                            type="text"
                            value={device}
                            onChange={e => setDevice(e.target.value)}
                            placeholder="Device (auto/cuda/cpu)"
                            style={{ ...inputStyle, width: '120px' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                            onClick={loadModel}
                            disabled={!serverRunning || serverStatus?.model_loading}
                            style={{ ...buttonStyle, opacity: (!serverRunning || serverStatus?.model_loading) ? 0.5 : 1 }}
                        >
                            {serverStatus?.model_loading ? 'Loading...' : 'Load Model'}
                        </button>
                        <button
                            onClick={unloadModel}
                            disabled={!serverStatus?.model_ready}
                            style={{ ...buttonSecondaryStyle, opacity: !serverStatus?.model_ready ? 0.5 : 1 }}
                        >
                            Unload
                        </button>
                        {serverStatus?.model_ready && (
                            <span style={{
                                color: THEME.semantic.success,
                                fontSize: '11px',
                                background: THEME.semantic.successMuted,
                                padding: '4px 10px',
                                borderRadius: '12px',
                            }}>
                                ✓ {serverStatus.model_name.split('/').pop()}
                            </span>
                        )}
                    </div>
                </div>

                {/* Generation Parameters */}
                <div style={sectionStyle}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 500, color: THEME.text.primary }}>Generation Settings</h4>

                    <div style={sliderContainerStyle}>
                        <span style={{ width: '120px', fontSize: '12px', color: THEME.text.secondary }}>Temp: {temperature.toFixed(2)}</span>
                        <input
                            type="range"
                            min={0.1}
                            max={2}
                            step={0.05}
                            value={temperature}
                            onChange={e => setTemperature(parseFloat(e.target.value))}
                            style={{ flex: 1, accentColor: THEME.accent.primary }}
                        />
                    </div>

                    <div style={sliderContainerStyle}>
                        <span style={{ width: '120px', fontSize: '12px', color: THEME.text.secondary }}>Max tokens: {maxNewTokens}</span>
                        <input
                            type="range"
                            min={64}
                            max={2048}
                            step={64}
                            value={maxNewTokens}
                            onChange={e => setMaxNewTokens(parseInt(e.target.value))}
                            style={{ flex: 1, accentColor: THEME.accent.primary }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                        <label style={{ fontSize: '12px', color: THEME.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={useHistory} onChange={e => setUseHistory(e.target.checked)} style={{ accentColor: THEME.accent.primary }} />
                            Use history
                        </label>
                        <label style={{ fontSize: '12px', color: THEME.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={showSystemPrompt} onChange={e => setShowSystemPrompt(e.target.checked)} style={{ accentColor: THEME.accent.primary }} />
                            System prompt
                        </label>
                    </div>

                    {showSystemPrompt && (
                        <textarea
                            value={systemPrompt}
                            onChange={e => setSystemPrompt(e.target.value)}
                            style={{ ...inputStyle, height: '50px', marginTop: '8px', resize: 'vertical' }}
                            placeholder="System prompt..."
                        />
                    )}
                </div>

                {/* Chat Messages */}
                <div style={{ flex: 1, background: THEME.bg.primary, borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '150px', maxHeight: '300px', marginBottom: '12px', border: `1px solid ${THEME.border.subtle}` }}>
                    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${THEME.border.subtle}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: THEME.bg.tertiary }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '11px', color: THEME.text.muted }}>Chat ({messages.length} messages)</span>
                            {/* Token Stats */}
                            <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
                                <span style={{ color: totalTokensUsed >= MAX_TOKENS_LIMIT ? THEME.semantic.error : totalTokensUsed >= MAX_TOKENS_LIMIT * 0.8 ? THEME.semantic.warning : THEME.text.muted }}>
                                    {totalTokensUsed.toLocaleString()} / {MAX_TOKENS_LIMIT.toLocaleString()} tokens
                                </span>
                                {lastTokensPerSec !== null && (
                                    <span style={{ color: THEME.accent.primary }}>
                                        {lastTokensPerSec.toFixed(1)} tok/s
                                    </span>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {totalTokensUsed > 0 && (
                                <button
                                    onClick={() => { setTotalTokensUsed(0); setLastTokensPerSec(null); setLastGenerationTokens(null); }}
                                    style={{ background: 'none', border: 'none', color: THEME.text.muted, fontSize: '9px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}
                                    title="Reset token counter"
                                >
                                    Reset
                                </button>
                            )}
                            <button
                                onClick={clearHistory}
                                disabled={!serverRunning}
                                style={{ background: 'none', border: 'none', color: THEME.text.muted, fontSize: '10px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div className="animated-char-scroll" style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                        {messages.length === 0 ? (
                            <div style={{ textAlign: 'center', color: THEME.text.muted, fontSize: '12px', marginTop: '20px' }}>
                                No messages yet. Start chatting with the AI character!
                            </div>
                        ) : (
                            messages.map((msg, i) => (
                                <div key={i} style={messageStyle(msg.role)}>
                                    <div style={{ fontSize: '10px', color: THEME.text.muted, marginBottom: '4px' }}>
                                        {msg.role === 'user' ? 'You' : 'AI'} {msg.timestamp && `• ${msg.timestamp}`}
                                    </div>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Token Limit Warning */}
                {totalTokensUsed >= MAX_TOKENS_LIMIT * 0.9 && (
                    <div style={{
                        padding: '8px 12px',
                        marginBottom: '10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        background: totalTokensUsed >= MAX_TOKENS_LIMIT ? THEME.semantic.errorMuted : THEME.semantic.warningMuted,
                        color: totalTokensUsed >= MAX_TOKENS_LIMIT ? THEME.semantic.error : THEME.semantic.warning,
                        border: `1px solid ${totalTokensUsed >= MAX_TOKENS_LIMIT ? THEME.semantic.error : THEME.semantic.warning}20`,
                    }}>
                        {totalTokensUsed >= MAX_TOKENS_LIMIT
                            ? 'Token limit reached. Clear history to continue chatting.'
                            : `Approaching token limit (${((totalTokensUsed / MAX_TOKENS_LIMIT) * 100).toFixed(0)}% used)`}
                    </div>
                )}

                {/* Chat Input */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                    <input
                        type="text"
                        value={inputMessage}
                        onChange={e => setInputMessage(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && !generating && totalTokensUsed < MAX_TOKENS_LIMIT && sendMessage()}
                        placeholder={totalTokensUsed >= MAX_TOKENS_LIMIT ? "Token limit reached - clear history" : "Type your message..."}
                        style={{ ...inputStyle, flex: 1 }}
                        disabled={!serverStatus?.model_ready || generating || totalTokensUsed >= MAX_TOKENS_LIMIT}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!serverStatus?.model_ready || generating || !inputMessage.trim() || totalTokensUsed >= MAX_TOKENS_LIMIT}
                        style={{
                            ...buttonStyle,
                            opacity: (!serverStatus?.model_ready || generating || !inputMessage.trim() || totalTokensUsed >= MAX_TOKENS_LIMIT) ? 0.5 : 1,
                            minWidth: '80px',
                        }}
                    >
                        {generating ? 'Thinking...' : 'Send'}
                    </button>
                </div>

                {/* Collapsible Logs Panel */}
                <div style={{
                    background: THEME.bg.primary,
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: `1px solid ${THEME.border.subtle}`,
                    flex: logsCollapsed ? '0 0 auto' : '1 1 auto',
                    minHeight: logsCollapsed ? 'auto' : '100px',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    {/* Logs Header - Always visible, clickable to collapse */}
                    <div
                        onClick={() => setLogsCollapsed(!logsCollapsed)}
                        style={{
                            padding: '8px 12px',
                            borderBottom: logsCollapsed ? 'none' : `1px solid ${THEME.border.subtle}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            background: THEME.bg.tertiary,
                            userSelect: 'none',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                                fontSize: '10px',
                                color: THEME.text.muted,
                                transform: logsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease',
                                display: 'inline-block',
                            }}>
                                ▼
                            </span>
                            <span style={{ fontSize: '12px', color: THEME.text.secondary, fontWeight: 500 }}>
                                Logs
                            </span>
                            <span style={{
                                fontSize: '10px',
                                color: THEME.text.muted,
                                background: THEME.bg.elevated,
                                padding: '2px 6px',
                                borderRadius: '10px',
                            }}>
                                {logs.length}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {!logsCollapsed && (
                                <>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setLogPanelHeight(Math.min(400, logPanelHeight + 50)); }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: THEME.text.muted,
                                            fontSize: '10px',
                                            cursor: 'pointer',
                                            padding: '4px 6px',
                                            borderRadius: '4px',
                                        }}
                                        title="Expand"
                                    >
                                        ↑
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setLogPanelHeight(Math.max(60, logPanelHeight - 50)); }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: THEME.text.muted,
                                            fontSize: '10px',
                                            cursor: 'pointer',
                                            padding: '4px 6px',
                                            borderRadius: '4px',
                                        }}
                                        title="Shrink"
                                    >
                                        ↓
                                    </button>
                                </>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: THEME.text.muted,
                                    fontSize: '10px',
                                    cursor: 'pointer',
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {/* Logs Content - Conditionally rendered */}
                    {!logsCollapsed && (
                        <>
                            {/* Resize Handle */}
                            <div
                                style={{
                                    height: '4px',
                                    background: THEME.bg.tertiary,
                                    cursor: 'ns-resize',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setIsResizingLogs(true);
                                    const startY = e.clientY;
                                    const startHeight = logPanelHeight;

                                    const handleMouseMove = (moveEvent: MouseEvent) => {
                                        const deltaY = startY - moveEvent.clientY;
                                        const newHeight = Math.min(400, Math.max(60, startHeight + deltaY));
                                        setLogPanelHeight(newHeight);
                                    };

                                    const handleMouseUp = () => {
                                        setIsResizingLogs(false);
                                        document.removeEventListener('mousemove', handleMouseMove);
                                        document.removeEventListener('mouseup', handleMouseUp);
                                    };

                                    document.addEventListener('mousemove', handleMouseMove);
                                    document.addEventListener('mouseup', handleMouseUp);
                                }}
                            >
                                <div style={{ width: '32px', height: '2px', background: THEME.border.default, borderRadius: '1px' }} />
                            </div>

                            {/* Logs Content */}
                            <div
                                className="animated-char-scroll"
                                style={{
                                    flex: 1,
                                    overflow: 'auto',
                                    padding: '8px 12px',
                                    fontSize: '11px',
                                    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
                                    lineHeight: '1.5',
                                }}
                            >
                                {logs.length === 0 ? (
                                    <div style={{ color: THEME.text.muted, textAlign: 'center', padding: '12px' }}>
                                        No logs yet
                                    </div>
                                ) : (
                                    logs.map((log, i) => (
                                        <div
                                            key={i}
                                            style={{
                                                color: log.includes('ERROR')
                                                    ? THEME.semantic.error
                                                    : log.includes('Response') || log.includes('loaded') || log.includes('success')
                                                        ? THEME.semantic.success
                                                        : THEME.text.secondary,
                                                marginBottom: '3px',
                                                padding: '2px 0',
                                            }}
                                        >
                                            {log}
                                        </div>
                                    ))
                                )}
                                <div ref={logsEndRef} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
