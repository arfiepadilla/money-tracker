// ============================================================================
// STL Viewer - Multi-Model Assembly Tool
// ============================================================================
// Features:
// - Load multiple STL files
// - Select and transform models (translate, rotate, scale)
// - Join models into single geometry
// - Export merged STL
// - Constraint system (hinge + slider joints)
// ============================================================================

// Types
interface ModelObject {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  originalGeometry: THREE.BufferGeometry;
  color: number;
  visible: boolean;
}

// Gizmo axis colors
const GIZMO_COLORS = {
  x: 0xff4444,  // Red
  y: 0x44ff44,  // Green
  z: 0x4444ff,  // Blue
  xHover: 0xff8888,
  yHover: 0x88ff88,
  zHover: 0x8888ff,
};

interface Constraint {
  id: string;
  name: string;
  type: 'hinge' | 'slider';
  parentId: string;
  childId: string;
  pivotParent: THREE.Vector3;
  pivotChild: THREE.Vector3;
  axis: THREE.Vector3;
  limits: { min: number; max: number };
  currentValue: number;
  // Visual helpers
  pivotHelper?: THREE.Mesh;
  axisHelper?: THREE.ArrowHelper;
}

// Color palette for models
const MODEL_COLORS = [
  0x6699cc, // Blue
  0xcc6666, // Red
  0x66cc66, // Green
  0xcccc66, // Yellow
  0xcc66cc, // Magenta
  0x66cccc, // Cyan
  0xcc9966, // Orange
  0x9966cc, // Purple
];

const STLViewerWindow = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationIdRef = useRef<number>(0);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  // Gizmo refs
  const gizmoGroupRef = useRef<THREE.Group | null>(null);
  const gizmoAxesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const isDraggingGizmoRef = useRef(false);
  const activeGizmoAxisRef = useRef<'x' | 'y' | 'z' | null>(null);
  const justFinishedDraggingRef = useRef(false);
  const dragStartPointRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());

  // Multi-model state
  const modelsRef = useRef<Map<string, ModelObject>>(new Map());
  const [models, setModels] = useState<ModelObject[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [colorIndex, setColorIndex] = useState(0);

  // Transform state
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const transformStep = 0.5; // Units for translate, degrees for rotate, factor for scale

  // Constraints state
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [constraintMode, setConstraintMode] = useState<'none' | 'pickParent' | 'pickChild'>('none');
  const [pendingConstraint, setPendingConstraint] = useState<Partial<Constraint> | null>(null);
  const [animatingConstraints, setAnimatingConstraints] = useState<Set<string>>(new Set());

  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<string>('iso');
  const [showModelsPanel, setShowModelsPanel] = useState(true);
  const [showConstraintsPanel, setShowConstraintsPanel] = useState(true);
  const [showTransformPanel, setShowTransformPanel] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [logMessages, setLogMessages] = useState<Array<{time: string; msg: string; type: 'info' | 'error' | 'warn'}>>([]);

  // Transform values for selected model (for UI display)
  const [transformValues, setTransformValues] = useState({
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1
  });

  // Add log message helper
  const addLog = useCallback((msg: string, type: 'info' | 'error' | 'warn' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [...prev.slice(-50), { time, msg, type }]);
    console.log(`[STLViewer ${type}]`, msg);
  }, []);

  // View presets
  const VIEW_DISTANCE = 20;
  const viewPresets: Record<string, { position: [number, number, number]; up: [number, number, number]; label: string }> = {
    front: { position: [0, 0, VIEW_DISTANCE], up: [0, 1, 0], label: 'Front' },
    back: { position: [0, 0, -VIEW_DISTANCE], up: [0, 1, 0], label: 'Back' },
    top: { position: [0, VIEW_DISTANCE, 0], up: [0, 0, -1], label: 'Top' },
    bottom: { position: [0, -VIEW_DISTANCE, 0], up: [0, 0, 1], label: 'Bottom' },
    left: { position: [-VIEW_DISTANCE, 0, 0], up: [0, 1, 0], label: 'Left' },
    right: { position: [VIEW_DISTANCE, 0, 0], up: [0, 1, 0], label: 'Right' },
    iso: { position: [VIEW_DISTANCE * 0.7, VIEW_DISTANCE * 0.7, VIEW_DISTANCE * 0.7], up: [0, 1, 0], label: 'Iso' }
  };

  // Set camera to a preset view
  const setView = useCallback((viewName: string) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const preset = viewPresets[viewName];

    if (!camera || !controls || !preset) return;

    camera.position.set(...preset.position);
    camera.up.set(...preset.up);
    controls.target.set(0, 0, 0);
    controls.update();
    setCurrentView(viewName);
  }, []);

  // Sync models array from Map for React rendering
  const syncModelsState = useCallback(() => {
    setModels(Array.from(modelsRef.current.values()));
  }, []);

  // Create transform gizmo
  const createGizmo = useCallback(() => {
    if (!sceneRef.current) return;

    // Remove existing gizmo
    if (gizmoGroupRef.current) {
      sceneRef.current.remove(gizmoGroupRef.current);
      gizmoGroupRef.current = null;
      gizmoAxesRef.current.clear();
    }

    const gizmo = new THREE.Group();
    gizmo.name = 'transformGizmo';
    gizmoGroupRef.current = gizmo;

    const axisLength = 2;
    const coneHeight = 0.4;
    const coneRadius = 0.12;
    const lineWidth = 3;

    // Create axis arrows for translate mode
    const createTranslateAxis = (axis: 'x' | 'y' | 'z', color: number) => {
      const group = new THREE.Group();
      group.name = `translate_${axis}`;

      // Direction vector
      const dir = new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0
      );

      // Line
      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        dir.clone().multiplyScalar(axisLength)
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
      const line = new THREE.Line(lineGeom, lineMat);
      group.add(line);

      // Cone (arrow head)
      const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 8);
      const coneMat = new THREE.MeshBasicMaterial({ color });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.copy(dir.clone().multiplyScalar(axisLength + coneHeight / 2));

      // Rotate cone to point along axis
      if (axis === 'x') cone.rotation.z = -Math.PI / 2;
      else if (axis === 'z') cone.rotation.x = Math.PI / 2;
      group.add(cone);

      // Invisible cylinder for easier picking
      const pickGeom = new THREE.CylinderGeometry(0.15, 0.15, axisLength + coneHeight, 8);
      const pickMat = new THREE.MeshBasicMaterial({ visible: false });
      const picker = new THREE.Mesh(pickGeom, pickMat);
      picker.position.copy(dir.clone().multiplyScalar((axisLength + coneHeight) / 2));
      if (axis === 'x') picker.rotation.z = Math.PI / 2;
      else if (axis === 'z') picker.rotation.x = Math.PI / 2;
      picker.userData.gizmoAxis = axis;
      picker.userData.gizmoType = 'translate';
      group.add(picker);

      return group;
    };

    // Create rotation rings
    const createRotateAxis = (axis: 'x' | 'y' | 'z', color: number) => {
      const group = new THREE.Group();
      group.name = `rotate_${axis}`;

      const ringRadius = 1.8;
      const tubeRadius = 0.04;

      const ringGeom = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color });
      const ring = new THREE.Mesh(ringGeom, ringMat);

      // Rotate ring to correct orientation
      if (axis === 'x') ring.rotation.y = Math.PI / 2;
      else if (axis === 'z') ring.rotation.x = Math.PI / 2;
      group.add(ring);

      // Invisible torus for picking
      const pickGeom = new THREE.TorusGeometry(ringRadius, 0.15, 8, 48);
      const pickMat = new THREE.MeshBasicMaterial({ visible: false });
      const picker = new THREE.Mesh(pickGeom, pickMat);
      if (axis === 'x') picker.rotation.y = Math.PI / 2;
      else if (axis === 'z') picker.rotation.x = Math.PI / 2;
      picker.userData.gizmoAxis = axis;
      picker.userData.gizmoType = 'rotate';
      group.add(picker);

      return group;
    };

    // Create scale handles (cubes at end of axes)
    const createScaleAxis = (axis: 'x' | 'y' | 'z', color: number) => {
      const group = new THREE.Group();
      group.name = `scale_${axis}`;

      const dir = new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0
      );

      // Line
      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        dir.clone().multiplyScalar(axisLength)
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
      const line = new THREE.Line(lineGeom, lineMat);
      group.add(line);

      // Cube at end
      const cubeSize = 0.2;
      const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
      const cubeMat = new THREE.MeshBasicMaterial({ color });
      const cube = new THREE.Mesh(cubeGeom, cubeMat);
      cube.position.copy(dir.clone().multiplyScalar(axisLength));
      group.add(cube);

      // Picker
      const pickGeom = new THREE.CylinderGeometry(0.15, 0.15, axisLength + cubeSize, 8);
      const pickMat = new THREE.MeshBasicMaterial({ visible: false });
      const picker = new THREE.Mesh(pickGeom, pickMat);
      picker.position.copy(dir.clone().multiplyScalar(axisLength / 2));
      if (axis === 'x') picker.rotation.z = Math.PI / 2;
      else if (axis === 'z') picker.rotation.x = Math.PI / 2;
      picker.userData.gizmoAxis = axis;
      picker.userData.gizmoType = 'scale';
      group.add(picker);

      return group;
    };

    // Add axes based on current transform mode
    const addAxes = (createFn: (axis: 'x' | 'y' | 'z', color: number) => THREE.Group) => {
      const xAxis = createFn('x', GIZMO_COLORS.x);
      const yAxis = createFn('y', GIZMO_COLORS.y);
      const zAxis = createFn('z', GIZMO_COLORS.z);
      gizmo.add(xAxis);
      gizmo.add(yAxis);
      gizmo.add(zAxis);
      gizmoAxesRef.current.set('x', xAxis);
      gizmoAxesRef.current.set('y', yAxis);
      gizmoAxesRef.current.set('z', zAxis);
    };

    if (transformMode === 'translate') {
      addAxes(createTranslateAxis);
    } else if (transformMode === 'rotate') {
      addAxes(createRotateAxis);
    } else if (transformMode === 'scale') {
      addAxes(createScaleAxis);
    }

    sceneRef.current.add(gizmo);
    gizmo.visible = false; // Will be shown when something is selected

  }, [transformMode]);

  // Update gizmo position to match selected model
  const updateGizmoPosition = useCallback(() => {
    const gizmo = gizmoGroupRef.current;
    if (!gizmo) return;

    // Get first selected model
    const firstSelectedId = Array.from(selectedIds)[0];
    if (!firstSelectedId) {
      gizmo.visible = false;
      return;
    }

    const model = modelsRef.current.get(firstSelectedId);
    if (!model) {
      gizmo.visible = false;
      return;
    }

    // Compute world-space bounding box
    model.mesh.geometry.computeBoundingBox();
    const box = model.mesh.geometry.boundingBox!.clone();
    box.applyMatrix4(model.mesh.matrixWorld);

    // Position gizmo at top-center of bounding box (so it's visible above the model)
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Offset upward by half the height plus a small margin
    const size = new THREE.Vector3();
    box.getSize(size);
    center.y = box.max.y + 0.5; // Position just above the top of the model

    gizmo.position.copy(center);
    gizmo.visible = true;
  }, [selectedIds]);

  // Sync transform values from selected model to UI
  const syncTransformValues = useCallback(() => {
    const firstSelectedId = Array.from(selectedIds)[0];
    if (!firstSelectedId) return;

    const model = modelsRef.current.get(firstSelectedId);
    if (!model) return;

    setTransformValues({
      posX: parseFloat(model.mesh.position.x.toFixed(3)),
      posY: parseFloat(model.mesh.position.y.toFixed(3)),
      posZ: parseFloat(model.mesh.position.z.toFixed(3)),
      rotX: parseFloat((model.mesh.rotation.x * 180 / Math.PI).toFixed(1)),
      rotY: parseFloat((model.mesh.rotation.y * 180 / Math.PI).toFixed(1)),
      rotZ: parseFloat((model.mesh.rotation.z * 180 / Math.PI).toFixed(1)),
      scaleX: parseFloat(model.mesh.scale.x.toFixed(3)),
      scaleY: parseFloat(model.mesh.scale.y.toFixed(3)),
      scaleZ: parseFloat(model.mesh.scale.z.toFixed(3))
    });
  }, [selectedIds]);

  // Apply transform value from UI to model
  const applyTransformValue = useCallback((property: string, value: number) => {
    selectedIds.forEach(id => {
      const model = modelsRef.current.get(id);
      if (!model) return;

      switch (property) {
        case 'posX': model.mesh.position.x = value; break;
        case 'posY': model.mesh.position.y = value; break;
        case 'posZ': model.mesh.position.z = value; break;
        case 'rotX': model.mesh.rotation.x = value * Math.PI / 180; break;
        case 'rotY': model.mesh.rotation.y = value * Math.PI / 180; break;
        case 'rotZ': model.mesh.rotation.z = value * Math.PI / 180; break;
        case 'scaleX': model.mesh.scale.x = Math.max(0.001, value); break;
        case 'scaleY': model.mesh.scale.y = Math.max(0.001, value); break;
        case 'scaleZ': model.mesh.scale.z = Math.max(0.001, value); break;
      }
    });

    // Update transform values state
    setTransformValues(prev => ({ ...prev, [property]: value }));

    // Update gizmo position
    updateGizmoPosition();
  }, [selectedIds, updateGizmoPosition]);

  // Generate unique ID
  const generateId = () => `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Parse binary STL
  const parseBinarySTL = (buffer: ArrayBuffer): { positions: number[]; normals: number[] } => {
    const reader = new DataView(buffer);
    const positions: number[] = [];
    const normals: number[] = [];

    const triangleCount = reader.getUint32(80, true);
    let offset = 84;

    for (let i = 0; i < triangleCount; i++) {
      const nx = reader.getFloat32(offset, true);
      const ny = reader.getFloat32(offset + 4, true);
      const nz = reader.getFloat32(offset + 8, true);
      offset += 12;

      for (let v = 0; v < 3; v++) {
        const x = reader.getFloat32(offset, true);
        const y = reader.getFloat32(offset + 4, true);
        const z = reader.getFloat32(offset + 8, true);
        offset += 12;

        positions.push(x, y, z);
        normals.push(nx, ny, nz);
      }
      offset += 2;
    }

    return { positions, normals };
  };

  // Parse ASCII STL
  const parseAsciiSTL = (text: string): { positions: number[]; normals: number[] } => {
    const positions: number[] = [];
    const normals: number[] = [];
    const lines = text.split('\n');
    let currentNormal = [0, 0, 1];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('facet normal')) {
        const parts = trimmed.split(/\s+/);
        currentNormal = [parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])];
      } else if (trimmed.startsWith('vertex')) {
        const parts = trimmed.split(/\s+/);
        positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        normals.push(...currentNormal);
      }
    }

    return { positions, normals };
  };

  // Detect STL type and parse
  const parseSTL = (buffer: ArrayBuffer): { positions: number[]; normals: number[] } => {
    const reader = new DataView(buffer);
    if (buffer.byteLength > 84) {
      const triangleCount = reader.getUint32(80, true);
      const expectedBinarySize = 84 + triangleCount * 50;
      if (buffer.byteLength === expectedBinarySize) {
        return parseBinarySTL(buffer);
      }
    }

    const text = new TextDecoder().decode(buffer);
    if (text.trim().startsWith('solid') && text.includes('facet normal')) {
      return parseAsciiSTL(text);
    }

    return parseBinarySTL(buffer);
  };

  // Center and scale geometry
  const centerAndScaleGeometry = (geometry: THREE.BufferGeometry): { size: THREE.Vector3; scale: number } => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 10 / maxDim : 1;
    geometry.scale(scale, scale, scale);

    return { size, scale };
  };

  // Load STL file
  const loadSTL = useCallback((file: File) => {
    addLog(`Loading: ${file.name}`);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const { positions, normals } = parseSTL(buffer);

        if (positions.length === 0) {
          setError('No geometry found in STL file');
          return;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        const { size } = centerAndScaleGeometry(geometry);

        // Get next color
        const color = MODEL_COLORS[colorIndex % MODEL_COLORS.length];
        setColorIndex(prev => prev + 1);

        const material = new THREE.MeshStandardMaterial({
          color,
          metalness: 0.3,
          roughness: 0.6,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Offset position if there are other models
        const existingCount = modelsRef.current.size;
        if (existingCount > 0) {
          mesh.position.x = existingCount * 5;
        }

        const id = generateId();
        const modelObject: ModelObject = {
          id,
          name: file.name.replace('.stl', '').replace('.STL', ''),
          mesh,
          originalGeometry: geometry.clone(),
          color,
          visible: true,
        };

        mesh.userData.modelId = id;
        modelsRef.current.set(id, modelObject);

        if (sceneRef.current) {
          sceneRef.current.add(mesh);
        }

        syncModelsState();
        addLog(`Loaded: ${modelObject.name} (${positions.length / 9} triangles)`);

      } catch (err) {
        setError(`Failed to parse STL: ${err}`);
        addLog(`Error: ${err}`, 'error');
      }
    };

    reader.onerror = () => setError('Failed to read file');
    reader.readAsArrayBuffer(file);
  }, [addLog, colorIndex, syncModelsState]);

  // Remove model
  const removeModel = useCallback((id: string) => {
    const model = modelsRef.current.get(id);
    if (model && sceneRef.current) {
      sceneRef.current.remove(model.mesh);
      model.mesh.geometry.dispose();
      (model.mesh.material as THREE.Material).dispose();
      modelsRef.current.delete(id);

      // Remove related constraints
      setConstraints(prev => prev.filter(c => c.parentId !== id && c.childId !== id));

      // Remove from selection
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      syncModelsState();
      addLog(`Removed model: ${model.name}`);
    }
  }, [syncModelsState, addLog]);

  // Toggle model visibility
  const toggleVisibility = useCallback((id: string) => {
    const model = modelsRef.current.get(id);
    if (model) {
      model.visible = !model.visible;
      model.mesh.visible = model.visible;
      syncModelsState();
    }
  }, [syncModelsState]);

  // Change model color
  const changeModelColor = useCallback((id: string, color: number) => {
    const model = modelsRef.current.get(id);
    if (model) {
      model.color = color;
      (model.mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
      syncModelsState();
    }
  }, [syncModelsState]);

  // Get all gizmo picker meshes
  const getGizmoPickers = useCallback((): THREE.Mesh[] => {
    const pickers: THREE.Mesh[] = [];
    gizmoAxesRef.current.forEach(axisGroup => {
      axisGroup.traverse(child => {
        if (child instanceof THREE.Mesh && child.userData.gizmoAxis) {
          pickers.push(child);
        }
      });
    });
    return pickers;
  }, []);

  // Handle mouse down on canvas
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    // Check if Shift+clicking on gizmo (Shift required to use gizmo)
    if (e.shiftKey && gizmoGroupRef.current?.visible) {
      const gizmoPickers = getGizmoPickers();
      const gizmoIntersects = raycasterRef.current.intersectObjects(gizmoPickers);

      if (gizmoIntersects.length > 0) {
        const hit = gizmoIntersects[0];
        const axis = hit.object.userData.gizmoAxis as 'x' | 'y' | 'z';

        isDraggingGizmoRef.current = true;
        activeGizmoAxisRef.current = axis;

        // Disable orbit controls while dragging gizmo
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }

        // Set up drag plane perpendicular to camera but containing the axis
        const gizmoPos = gizmoGroupRef.current.position.clone();
        const cameraDir = new THREE.Vector3();
        cameraRef.current.getWorldDirection(cameraDir);

        // Create a plane that contains the axis line and faces the camera
        const axisDir = new THREE.Vector3(
          axis === 'x' ? 1 : 0,
          axis === 'y' ? 1 : 0,
          axis === 'z' ? 1 : 0
        );

        // Plane normal is perpendicular to both axis and camera direction
        let planeNormal = new THREE.Vector3().crossVectors(axisDir, cameraDir);
        if (planeNormal.lengthSq() < 0.01) {
          // Axis and camera are parallel, use a different approach
          planeNormal = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(0, 1, 0));
          if (planeNormal.lengthSq() < 0.01) {
            planeNormal = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(1, 0, 0));
          }
        }
        planeNormal.normalize();

        dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, gizmoPos);

        // Get initial intersection point
        const intersectPoint = new THREE.Vector3();
        raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersectPoint);
        dragStartPointRef.current.copy(intersectPoint);

        return; // Don't process as model click
      }
    }
  }, [getGizmoPickers]);

  // Handle mouse move on canvas
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Handle gizmo dragging
    if (isDraggingGizmoRef.current && activeGizmoAxisRef.current) {
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

      const intersectPoint = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersectPoint)) {
        const axis = activeGizmoAxisRef.current;
        const delta = intersectPoint.clone().sub(dragStartPointRef.current);

        // Project delta onto axis
        const axisDir = new THREE.Vector3(
          axis === 'x' ? 1 : 0,
          axis === 'y' ? 1 : 0,
          axis === 'z' ? 1 : 0
        );
        const axisDelta = axisDir.dot(delta);

        // Apply transform to all selected models
        selectedIds.forEach(id => {
          const model = modelsRef.current.get(id);
          if (!model) return;

          if (transformMode === 'translate') {
            model.mesh.position[axis] += axisDelta;
          } else if (transformMode === 'rotate') {
            // Convert linear movement to rotation (scaled)
            const rotationAmount = axisDelta * 0.5;
            model.mesh.rotation[axis] += rotationAmount;
          } else if (transformMode === 'scale') {
            // Scale based on movement
            const scaleFactor = 1 + axisDelta * 0.1;
            if (scaleFactor > 0.1) {
              model.mesh.scale[axis] *= scaleFactor;
            }
          }
        });

        // Update drag start for next frame
        dragStartPointRef.current.copy(intersectPoint);

        // Update gizmo position
        updateGizmoPosition();
      }
      return;
    }

    // Highlight gizmo axis on hover
    if (gizmoGroupRef.current?.visible) {
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const gizmoPickers = getGizmoPickers();
      const gizmoIntersects = raycasterRef.current.intersectObjects(gizmoPickers);

      // Reset all colors
      gizmoAxesRef.current.forEach((group, axis) => {
        const color = GIZMO_COLORS[axis as 'x' | 'y' | 'z'];
        group.traverse(child => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial && child.material.visible) {
            child.material.color.setHex(color);
          }
          if (child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
            child.material.color.setHex(color);
          }
        });
      });

      // Highlight hovered axis
      if (gizmoIntersects.length > 0) {
        const axis = gizmoIntersects[0].object.userData.gizmoAxis as 'x' | 'y' | 'z';
        const hoverColor = GIZMO_COLORS[`${axis}Hover` as keyof typeof GIZMO_COLORS];
        const group = gizmoAxesRef.current.get(axis);
        if (group) {
          group.traverse(child => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial && child.material.visible) {
              child.material.color.setHex(hoverColor);
            }
            if (child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
              child.material.color.setHex(hoverColor);
            }
          });
        }
      }
    }
  }, [selectedIds, transformMode, updateGizmoPosition, getGizmoPickers]);

  // Handle mouse up on canvas
  const handleCanvasMouseUp = useCallback(() => {
    if (isDraggingGizmoRef.current) {
      isDraggingGizmoRef.current = false;
      activeGizmoAxisRef.current = null;

      // Set flag to prevent click handler from deselecting
      justFinishedDraggingRef.current = true;
      // Clear the flag after a short delay (after click event fires)
      setTimeout(() => {
        justFinishedDraggingRef.current = false;
      }, 10);

      // Sync transform values after gizmo drag
      syncTransformValues();

      // Re-enable orbit controls
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    }
  }, [syncTransformValues]);

  // Selection handling (click)
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // Don't process click if we were dragging gizmo or just finished dragging
    if (isDraggingGizmoRef.current || justFinishedDraggingRef.current) return;

    if (!containerRef.current || !cameraRef.current) return;

    // Don't process if in constraint mode
    if (constraintMode !== 'none') {
      handleConstraintClick(e);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    // Check if clicking on gizmo - if so, don't change selection
    if (gizmoGroupRef.current?.visible) {
      const gizmoPickers = getGizmoPickers();
      const gizmoIntersects = raycasterRef.current.intersectObjects(gizmoPickers);
      if (gizmoIntersects.length > 0) return;
    }

    const meshes = Array.from(modelsRef.current.values()).map(m => m.mesh);
    const intersects = raycasterRef.current.intersectObjects(meshes);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object as THREE.Mesh;
      const modelId = clickedMesh.userData.modelId;

      if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(modelId)) {
            next.delete(modelId);
          } else {
            next.add(modelId);
          }
          return next;
        });
      } else {
        // Single select
        setSelectedIds(new Set([modelId]));
      }
    } else if (!e.ctrlKey && !e.metaKey) {
      // Deselect all
      setSelectedIds(new Set());
    }
  }, [constraintMode, getGizmoPickers]);

  // Handle constraint pivot point selection
  const handleConstraintClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !pendingConstraint) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    const meshes = Array.from(modelsRef.current.values()).map(m => m.mesh);
    const intersects = raycasterRef.current.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const clickedMesh = hit.object as THREE.Mesh;
      const modelId = clickedMesh.userData.modelId;
      const localPoint = clickedMesh.worldToLocal(hit.point.clone());
      const normal = hit.face?.normal.clone() || new THREE.Vector3(0, 1, 0);

      if (constraintMode === 'pickParent') {
        setPendingConstraint({
          ...pendingConstraint,
          parentId: modelId,
          pivotParent: localPoint,
          axis: normal,
        });
        setConstraintMode('pickChild');
        addLog(`Parent pivot set on ${modelsRef.current.get(modelId)?.name}. Click child model.`);
      } else if (constraintMode === 'pickChild') {
        if (modelId === pendingConstraint.parentId) {
          addLog('Cannot connect model to itself', 'warn');
          return;
        }

        const newConstraint: Constraint = {
          id: `constraint_${Date.now()}`,
          name: `${pendingConstraint.type} ${constraints.length + 1}`,
          type: pendingConstraint.type!,
          parentId: pendingConstraint.parentId!,
          childId: modelId,
          pivotParent: pendingConstraint.pivotParent!,
          pivotChild: localPoint,
          axis: pendingConstraint.axis!,
          limits: pendingConstraint.type === 'hinge'
            ? { min: -90, max: 90 }
            : { min: -5, max: 5 },
          currentValue: 0,
        };

        // Create visual helpers
        createConstraintHelpers(newConstraint);

        setConstraints(prev => [...prev, newConstraint]);
        setConstraintMode('none');
        setPendingConstraint(null);
        addLog(`Created ${newConstraint.type} constraint`);
      }
    }
  }, [constraintMode, pendingConstraint, constraints.length, addLog]);

  // Create visual helpers for constraint
  const createConstraintHelpers = useCallback((constraint: Constraint) => {
    const parent = modelsRef.current.get(constraint.parentId);
    if (!parent || !sceneRef.current) return;

    // Pivot sphere
    const pivotGeom = new THREE.SphereGeometry(0.2);
    const pivotMat = new THREE.MeshBasicMaterial({
      color: constraint.type === 'hinge' ? 0xff8800 : 0x0088ff
    });
    const pivotMesh = new THREE.Mesh(pivotGeom, pivotMat);

    const worldPivot = constraint.pivotParent.clone()
      .applyMatrix4(parent.mesh.matrixWorld);
    pivotMesh.position.copy(worldPivot);

    constraint.pivotHelper = pivotMesh;
    sceneRef.current.add(pivotMesh);

    // Axis arrow
    const axisHelper = new THREE.ArrowHelper(
      constraint.axis.clone().normalize(),
      worldPivot,
      2,
      constraint.type === 'hinge' ? 0xff8800 : 0x0088ff
    );
    constraint.axisHelper = axisHelper;
    sceneRef.current.add(axisHelper);
  }, []);

  // Apply constraint
  const applyConstraint = useCallback((constraint: Constraint) => {
    const parent = modelsRef.current.get(constraint.parentId);
    const child = modelsRef.current.get(constraint.childId);
    if (!parent || !child) return;

    // Get world pivot position
    const pivotWorld = constraint.pivotParent.clone()
      .applyMatrix4(parent.mesh.matrixWorld);

    if (constraint.type === 'hinge') {
      const angle = THREE.MathUtils.degToRad(constraint.currentValue);
      const rotation = new THREE.Quaternion()
        .setFromAxisAngle(constraint.axis.clone().normalize(), angle);

      // Reset child to base position relative to pivot
      const offset = constraint.pivotChild.clone().negate();
      offset.applyQuaternion(rotation);

      child.mesh.position.copy(pivotWorld).add(offset);
      child.mesh.quaternion.copy(rotation);
    } else {
      // Slider
      const offset = constraint.axis.clone()
        .normalize()
        .multiplyScalar(constraint.currentValue);

      const baseOffset = constraint.pivotChild.clone().negate();
      child.mesh.position.copy(pivotWorld).add(baseOffset).add(offset);
    }

    // Update helpers
    if (constraint.pivotHelper) {
      constraint.pivotHelper.position.copy(pivotWorld);
    }
    if (constraint.axisHelper) {
      constraint.axisHelper.position.copy(pivotWorld);
    }
  }, []);

  // Update constraint value
  const updateConstraintValue = useCallback((id: string, value: number) => {
    setConstraints(prev => prev.map(c => {
      if (c.id === id) {
        const clamped = Math.max(c.limits.min, Math.min(c.limits.max, value));
        const updated = { ...c, currentValue: clamped };
        applyConstraint(updated);
        return updated;
      }
      return c;
    }));
  }, [applyConstraint]);

  // Remove constraint
  const removeConstraint = useCallback((id: string) => {
    setConstraints(prev => {
      const constraint = prev.find(c => c.id === id);
      if (constraint && sceneRef.current) {
        if (constraint.pivotHelper) {
          sceneRef.current.remove(constraint.pivotHelper);
          constraint.pivotHelper.geometry.dispose();
          (constraint.pivotHelper.material as THREE.Material).dispose();
        }
        if (constraint.axisHelper) {
          sceneRef.current.remove(constraint.axisHelper);
        }
      }
      return prev.filter(c => c.id !== id);
    });
  }, []);

  // Start constraint animation
  const toggleConstraintAnimation = useCallback((id: string) => {
    setAnimatingConstraints(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Animation loop for constraints
  useEffect(() => {
    if (animatingConstraints.size === 0) return;

    let lastTime = performance.now();
    let animId: number;

    const animate = () => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      setConstraints(prev => prev.map(c => {
        if (!animatingConstraints.has(c.id)) return c;

        const range = c.limits.max - c.limits.min;
        const speed = range / 2; // Complete cycle in ~4 seconds
        let newValue = c.currentValue + speed * delta;

        // Bounce at limits
        if (newValue > c.limits.max) {
          newValue = c.limits.max - (newValue - c.limits.max);
        } else if (newValue < c.limits.min) {
          newValue = c.limits.min + (c.limits.min - newValue);
        }

        const updated = { ...c, currentValue: newValue };
        applyConstraint(updated);
        return updated;
      }));

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [animatingConstraints, applyConstraint]);

  // Transform selected models
  const transformSelected = useCallback((axis: 'x' | 'y' | 'z', direction: 1 | -1) => {
    selectedIds.forEach(id => {
      const model = modelsRef.current.get(id);
      if (!model) return;

      const amount = transformStep * direction;

      switch (transformMode) {
        case 'translate':
          model.mesh.position[axis] += amount;
          break;
        case 'rotate':
          model.mesh.rotation[axis] += THREE.MathUtils.degToRad(amount * 10);
          break;
        case 'scale':
          const scaleFactor = 1 + amount * 0.1;
          model.mesh.scale[axis] *= scaleFactor;
          break;
      }
    });
  }, [selectedIds, transformMode, transformStep]);

  // Join selected models
  const joinSelectedModels = useCallback(() => {
    if (selectedIds.size < 2) {
      addLog('Select at least 2 models to join', 'warn');
      return;
    }

    const geometries: THREE.BufferGeometry[] = [];
    const modelNames: string[] = [];

    selectedIds.forEach(id => {
      const model = modelsRef.current.get(id);
      if (!model) return;

      // Clone geometry and apply world transform
      const clonedGeom = model.mesh.geometry.clone();
      clonedGeom.applyMatrix4(model.mesh.matrixWorld);
      geometries.push(clonedGeom);
      modelNames.push(model.name);
    });

    if (geometries.length < 2) return;

    // Manual merge since BufferGeometryUtils might not be available
    const mergedGeometry = mergeGeometries(geometries);

    // Clean up cloned geometries
    geometries.forEach(g => g.dispose());

    // Create new model
    const color = MODEL_COLORS[colorIndex % MODEL_COLORS.length];
    setColorIndex(prev => prev + 1);

    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(mergedGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const id = generateId();
    const newModel: ModelObject = {
      id,
      name: `Joined_${modelNames.join('_').substring(0, 20)}`,
      mesh,
      originalGeometry: mergedGeometry.clone(),
      color,
      visible: true,
    };

    mesh.userData.modelId = id;

    // Remove original models
    selectedIds.forEach(id => removeModel(id));

    // Add new model
    modelsRef.current.set(id, newModel);
    if (sceneRef.current) {
      sceneRef.current.add(mesh);
    }

    setSelectedIds(new Set([id]));
    syncModelsState();
    addLog(`Joined ${modelNames.length} models`);
  }, [selectedIds, colorIndex, removeModel, syncModelsState, addLog]);

  // Manual geometry merge
  const mergeGeometries = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    let totalPositions = 0;
    let totalNormals = 0;

    geometries.forEach(g => {
      totalPositions += g.attributes.position.count * 3;
      if (g.attributes.normal) {
        totalNormals += g.attributes.normal.count * 3;
      }
    });

    const positions = new Float32Array(totalPositions);
    const normals = new Float32Array(totalNormals);

    let posOffset = 0;
    let normOffset = 0;

    geometries.forEach(g => {
      const pos = g.attributes.position.array;
      positions.set(pos, posOffset);
      posOffset += pos.length;

      if (g.attributes.normal) {
        const norm = g.attributes.normal.array;
        normals.set(norm, normOffset);
        normOffset += norm.length;
      }
    });

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    return merged;
  };

  // Export STL
  const exportSTL = useCallback(() => {
    const visibleModels = Array.from(modelsRef.current.values()).filter(m => m.visible);

    if (visibleModels.length === 0) {
      addLog('No visible models to export', 'warn');
      return;
    }

    // Merge all visible geometries
    const geometries = visibleModels.map(model => {
      const cloned = model.mesh.geometry.clone();
      cloned.applyMatrix4(model.mesh.matrixWorld);
      return cloned;
    });

    const mergedGeometry = geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries);

    // Generate binary STL
    const positions = mergedGeometry.attributes.position.array;
    const triangleCount = positions.length / 9;

    // Header (80 bytes) + triangle count (4 bytes) + triangles (50 bytes each)
    const bufferSize = 84 + triangleCount * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header
    const header = 'Binary STL exported from STL Viewer';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }

    // Triangle count
    view.setUint32(80, triangleCount, true);

    // Triangles
    let offset = 84;
    for (let i = 0; i < triangleCount; i++) {
      const idx = i * 9;

      // Compute normal from vertices
      const v0 = new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2]);
      const v1 = new THREE.Vector3(positions[idx + 3], positions[idx + 4], positions[idx + 5]);
      const v2 = new THREE.Vector3(positions[idx + 6], positions[idx + 7], positions[idx + 8]);

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Normal
      view.setFloat32(offset, normal.x, true); offset += 4;
      view.setFloat32(offset, normal.y, true); offset += 4;
      view.setFloat32(offset, normal.z, true); offset += 4;

      // Vertices
      for (let j = 0; j < 9; j++) {
        view.setFloat32(offset, positions[idx + j], true);
        offset += 4;
      }

      // Attribute byte count
      view.setUint16(offset, 0, true);
      offset += 2;
    }

    // Clean up
    geometries.forEach(g => g.dispose());
    if (geometries.length > 1) {
      mergedGeometry.dispose();
    }

    // Download
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exported_${Date.now()}.stl`;
    a.click();
    URL.revokeObjectURL(url);

    addLog(`Exported ${triangleCount} triangles`);
  }, [addLog]);

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(15, 15, 15);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
    scene.add(gridHelper);

    // Axes
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(10, 20, 10);
    directionalLight1.castShadow = true;
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-10, 10, -10);
    scene.add(directionalLight2);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    scene.add(hemiLight);

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
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
  }, []);

  // Update selection highlighting
  useEffect(() => {
    modelsRef.current.forEach((model, id) => {
      const material = model.mesh.material as THREE.MeshStandardMaterial;
      if (selectedIds.has(id)) {
        material.emissive.setHex(0x333333);
      } else {
        material.emissive.setHex(0x000000);
      }
    });

    // Update gizmo position when selection changes
    updateGizmoPosition();

    // Sync transform values when selection changes
    syncTransformValues();
  }, [selectedIds, updateGizmoPosition, syncTransformValues]);

  // Recreate gizmo when transform mode changes
  useEffect(() => {
    createGizmo();
    updateGizmoPosition();
  }, [transformMode, createGizmo, updateGizmoPosition]);

  // Create initial gizmo after scene is ready
  useEffect(() => {
    // Small delay to ensure scene is initialized
    const timer = setTimeout(() => {
      createGizmo();
    }, 100);
    return () => clearTimeout(timer);
  }, [createGizmo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key.toLowerCase()) {
        case 'g':
          setTransformMode('translate');
          break;
        case 'r':
          setTransformMode('rotate');
          break;
        case 's':
          if (!e.ctrlKey) setTransformMode('scale');
          break;
        case 'delete':
        case 'backspace':
          selectedIds.forEach(id => removeModel(id));
          break;
        case 'arrowleft':
          transformSelected('x', -1);
          break;
        case 'arrowright':
          transformSelected('x', 1);
          break;
        case 'arrowup':
          if (e.shiftKey) transformSelected('y', 1);
          else transformSelected('z', -1);
          break;
        case 'arrowdown':
          if (e.shiftKey) transformSelected('y', -1);
          else transformSelected('z', 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, removeModel, transformSelected]);

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      if (file.name.toLowerCase().endsWith('.stl')) {
        loadSTL(file);
      }
    });
  }, [loadSTL]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => loadSTL(file));
    e.target.value = '';
  }, [loadSTL]);

  // Tailwind class helpers
  const buttonClass = 'py-1.5 px-3 bg-blue-700 text-white border-none rounded cursor-pointer text-[13px] font-medium';
  const viewButtonClass = (isActive: boolean) =>
    `py-1 px-2 border border-blue-700 rounded cursor-pointer text-[11px] font-medium min-w-[42px] ${
      isActive ? 'bg-blue-700 text-white' : 'bg-[#333355] text-slate-400'
    }`;
  const panelHeaderClass = 'py-2 px-3 bg-[#252540] border-b border-[#333355] text-xs font-semibold flex justify-between items-center';
  const modelItemClass = (isSelected: boolean) =>
    `p-2 mb-1 rounded cursor-pointer ${
      isSelected ? 'bg-[#334466] border border-blue-700' : 'bg-[#252540] border border-transparent'
    }`;
  const inputClass = 'w-[55px] py-0.5 px-1 text-[11px] bg-[#1a1a2e] border border-[#333355] rounded text-slate-300';

  return (
    <div className="w-full h-full flex flex-col bg-[#1a1a2e] text-slate-200 font-sans overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 py-2 px-3 bg-[#252540] border-b border-[#333355] flex-shrink-0 flex-wrap">
        <label className={buttonClass}>
          Open STL
          <input
            type="file"
            accept=".stl"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
        </label>

        <div className="w-px h-6 bg-[#444466] mx-1" />

        <span className="text-[11px] text-slate-500">Transform:</span>
        <button
          className={viewButtonClass(transformMode === 'translate')}
          onClick={() => setTransformMode('translate')}
          title="Translate (G)"
        >
          Move
        </button>
        <button
          className={viewButtonClass(transformMode === 'rotate')}
          onClick={() => setTransformMode('rotate')}
          title="Rotate (R)"
        >
          Rotate
        </button>
        <button
          className={viewButtonClass(transformMode === 'scale')}
          onClick={() => setTransformMode('scale')}
          title="Scale (S)"
        >
          Scale
        </button>

        <div className="w-px h-6 bg-[#444466] mx-1" />

        <button
          className={`${buttonClass} ${selectedIds.size >= 2 ? 'bg-green-600' : 'bg-slate-600'}`}
          onClick={joinSelectedModels}
          disabled={selectedIds.size < 2}
          title="Join selected models"
        >
          Join ({selectedIds.size})
        </button>

        <button
          className={`${buttonClass} ${models.length > 0 ? 'bg-orange-700' : 'bg-slate-600'}`}
          onClick={exportSTL}
          disabled={models.length === 0}
          title="Export all visible as STL"
        >
          Export STL
        </button>

        <div className="w-px h-6 bg-[#444466] mx-1" />

        <span className="text-[11px] text-slate-500">View:</span>
        {['front', 'top', 'right', 'iso'].map(view => (
          <button
            key={view}
            className={viewButtonClass(currentView === view)}
            onClick={() => setView(view)}
          >
            {view.charAt(0).toUpperCase() + view.slice(1)}
          </button>
        ))}

        <div className="ml-auto text-xs text-slate-500">
          {models.length} model{models.length !== 1 ? 's' : ''} | {selectedIds.size} selected
        </div>
      </div>

      {error && (
        <div className="py-2 px-3 bg-red-950 text-red-400 text-[13px]">
          {error}
        </div>
      )}

      {constraintMode !== 'none' && (
        <div className="py-2 px-3 bg-teal-950 text-cyan-300 text-[13px]">
          {constraintMode === 'pickParent' ? 'Click on parent model to set pivot point' : 'Click on child model to set attachment point'}
          <button
            onClick={() => { setConstraintMode('none'); setPendingConstraint(null); }}
            className="ml-3 py-0.5 px-2 text-[11px] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Models Panel */}
        {showModelsPanel && (
          <div className="w-[220px] bg-[#1e1e2e] border-r border-[#333355] flex flex-col overflow-hidden">
            <div className={panelHeaderClass}>
              <span>Models</span>
              <button
                onClick={() => setShowModelsPanel(false)}
                className="bg-transparent border-none text-slate-500 cursor-pointer"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {models.length === 0 ? (
                <div className="text-slate-600 text-xs text-center p-5">
                  Drop STL files here<br />or click Open STL
                </div>
              ) : (
                models.map(model => (
                  <div
                    key={model.id}
                    className={modelItemClass(selectedIds.has(model.id))}
                    onClick={(e) => {
                      if (e.ctrlKey) {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(model.id)) next.delete(model.id);
                          else next.add(model.id);
                          return next;
                        });
                      } else {
                        setSelectedIds(new Set([model.id]));
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-3.5 h-3.5 rounded-sm cursor-pointer"
                        style={{ backgroundColor: `#${model.color.toString(16).padStart(6, '0')}` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newColor = MODEL_COLORS[(MODEL_COLORS.indexOf(model.color) + 1) % MODEL_COLORS.length];
                          changeModelColor(model.id, newColor);
                        }}
                        title="Click to change color"
                      />
                      <span className="flex-1 text-xs overflow-hidden text-ellipsis">
                        {model.name}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisibility(model.id); }}
                        className={`bg-transparent border-none cursor-pointer text-sm ${model.visible ? 'text-green-400' : 'text-slate-600'}`}
                        title={model.visible ? 'Hide' : 'Show'}
                      >
                        {model.visible ? '👁' : '○'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeModel(model.id); }}
                        className="bg-transparent border-none text-red-400 cursor-pointer text-xs"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Transform Panel */}
        {showTransformPanel && selectedIds.size > 0 && (
          <div className="w-[200px] bg-[#1e1e2e] border-r border-[#333355] flex flex-col overflow-hidden">
            <div className={panelHeaderClass}>
              <span>Transform</span>
              <button
                onClick={() => setShowTransformPanel(false)}
                className="bg-transparent border-none text-slate-500 cursor-pointer"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {/* Position */}
              <div className="mb-3">
                <div className="text-[11px] text-slate-500 mb-1.5 font-semibold">Position</div>
                {(['X', 'Y', 'Z'] as const).map(axis => (
                  <div key={`pos${axis}`} className="flex items-center gap-1.5 mb-1">
                    <span className={`w-3.5 text-[11px] ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>{axis}</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={0.1}
                      value={transformValues[`pos${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`pos${axis}`, parseFloat(e.target.value))}
                      className="flex-1 h-3.5"
                    />
                    <input
                      type="number"
                      step={0.1}
                      value={transformValues[`pos${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`pos${axis}`, parseFloat(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>

              {/* Rotation */}
              <div className="mb-3">
                <div className="text-[11px] text-slate-500 mb-1.5 font-semibold">Rotation (°)</div>
                {(['X', 'Y', 'Z'] as const).map(axis => (
                  <div key={`rot${axis}`} className="flex items-center gap-1.5 mb-1">
                    <span className={`w-3.5 text-[11px] ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>{axis}</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={transformValues[`rot${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`rot${axis}`, parseFloat(e.target.value))}
                      className="flex-1 h-3.5"
                    />
                    <input
                      type="number"
                      step={1}
                      value={transformValues[`rot${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`rot${axis}`, parseFloat(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>

              {/* Scale */}
              <div className="mb-3">
                <div className="text-[11px] text-slate-500 mb-1.5 font-semibold">Scale</div>
                {(['X', 'Y', 'Z'] as const).map(axis => (
                  <div key={`scale${axis}`} className="flex items-center gap-1.5 mb-1">
                    <span className={`w-3.5 text-[11px] ${axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'}`}>{axis}</span>
                    <input
                      type="range"
                      min={0.01}
                      max={10}
                      step={0.01}
                      value={transformValues[`scale${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`scale${axis}`, parseFloat(e.target.value))}
                      className="flex-1 h-3.5"
                    />
                    <input
                      type="number"
                      step={0.01}
                      min={0.001}
                      value={transformValues[`scale${axis}` as keyof typeof transformValues]}
                      onChange={(e) => applyTransformValue(`scale${axis}`, parseFloat(e.target.value) || 1)}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>

              {/* Reset button */}
              <button
                onClick={() => {
                  selectedIds.forEach(id => {
                    const model = modelsRef.current.get(id);
                    if (model) {
                      model.mesh.position.set(0, 0, 0);
                      model.mesh.rotation.set(0, 0, 0);
                      model.mesh.scale.set(1, 1, 1);
                    }
                  });
                  syncTransformValues();
                  updateGizmoPosition();
                }}
                className={`${buttonClass} w-full bg-[#444466]`}
              >
                Reset Transform
              </button>
            </div>
          </div>
        )}

        {/* 3D Viewport */}
        <div
          ref={containerRef}
          className={`flex-1 relative overflow-hidden ${isDraggingGizmoRef.current ? 'cursor-grabbing' : 'cursor-default'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={handleCanvasClick}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {isDragging && (
            <div className="absolute inset-0 bg-blue-700/30 border-[3px] border-dashed border-blue-700 flex items-center justify-center text-xl text-white pointer-events-none">
              Drop STL files here
            </div>
          )}

          {models.length === 0 && !isDragging && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-slate-500 pointer-events-none">
              <div className="text-5xl mb-4 opacity-50">⬡</div>
              <div className="text-base mb-2">No models loaded</div>
              <div className="text-[13px]">Drag and drop STL files or click "Open STL"</div>
            </div>
          )}

          {/* Panel toggle buttons */}
          {!showModelsPanel && (
            <button
              onClick={() => setShowModelsPanel(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 py-2 px-1 bg-[#252540] border border-[#333355] border-l-0 rounded-r text-slate-400 cursor-pointer"
            >
              ▶
            </button>
          )}

          {!showConstraintsPanel && (
            <button
              onClick={() => setShowConstraintsPanel(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 py-2 px-1 bg-[#252540] border border-[#333355] border-r-0 rounded-l text-slate-400 cursor-pointer"
            >
              ◀
            </button>
          )}
        </div>

        {/* Constraints Panel */}
        {showConstraintsPanel && (
          <div className="w-[220px] bg-[#1e1e2e] border-l border-[#333355] flex flex-col overflow-hidden">
            <div className={panelHeaderClass}>
              <span>Constraints</span>
              <button
                onClick={() => setShowConstraintsPanel(false)}
                className="bg-transparent border-none text-slate-500 cursor-pointer"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <div className="mb-3">
                <button
                  className={`${buttonClass} w-full mb-1 bg-orange-700`}
                  onClick={() => {
                    setPendingConstraint({ type: 'hinge' });
                    setConstraintMode('pickParent');
                  }}
                  disabled={models.length < 2}
                >
                  + Add Hinge
                </button>
                <button
                  className={`${buttonClass} w-full bg-blue-700`}
                  onClick={() => {
                    setPendingConstraint({ type: 'slider' });
                    setConstraintMode('pickParent');
                  }}
                  disabled={models.length < 2}
                >
                  + Add Slider
                </button>
              </div>

              {constraints.length === 0 ? (
                <div className="text-slate-600 text-xs text-center p-5">
                  No constraints.<br />Load 2+ models to create joints.
                </div>
              ) : (
                constraints.map(constraint => (
                  <div key={constraint.id} className="p-2 mb-2 bg-[#252540] rounded">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold">
                        {constraint.type === 'hinge' ? '🔄' : '↔️'} {constraint.name}
                      </span>
                      <button
                        onClick={() => removeConstraint(constraint.id)}
                        className="bg-transparent border-none text-red-400 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 mb-2">
                      {modelsRef.current.get(constraint.parentId)?.name} → {modelsRef.current.get(constraint.childId)?.name}
                    </div>
                    <div className="mb-1">
                      <input
                        type="range"
                        min={constraint.limits.min}
                        max={constraint.limits.max}
                        step={constraint.type === 'hinge' ? 1 : 0.1}
                        value={constraint.currentValue}
                        onChange={(e) => updateConstraintValue(constraint.id, parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">
                        {constraint.currentValue.toFixed(1)}{constraint.type === 'hinge' ? '°' : ''}
                      </span>
                      <button
                        onClick={() => toggleConstraintAnimation(constraint.id)}
                        className={`py-0.5 px-2 text-[11px] text-white border-none rounded cursor-pointer ${
                          animatingConstraints.has(constraint.id) ? 'bg-red-700' : 'bg-[#444466]'
                        }`}
                      >
                        {animatingConstraints.has(constraint.id) ? 'Stop' : 'Animate'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <div className="py-1 px-3 bg-[#1e1e2e] border-t border-[#333355] text-[11px] text-slate-600">
        <span className="mr-4">G: Move</span>
        <span className="mr-4">R: Rotate</span>
        <span className="mr-4">S: Scale</span>
        <span className="mr-4">Shift+Drag: Use gizmo</span>
        <span className="mr-4">Ctrl+Click: Multi-select</span>
        <span>Del: Remove</span>
      </div>
    </div>
  );
};

(window as any).STLViewerWindow = STLViewerWindow;
