import Hammerjs from 'hammerjs';
import { BabylonController } from '@/Babylon';
import PointerSession from '@/PointerSession';

const defaultHammerRecognizerNames = [
  'pan',
  'pinch',
  'rotate',
  'press',
  'swipe',
  'tap'
];

const MIN_SWIPE_THRESHOLD = 10;
const MIN_SWIPE_SEG = 50;

class PointerEffect {
  private _hammer: HammerManager | null = null;
  private _target: HTMLCanvasElement | null = null;
  private _babylon: BabylonController | null = null;
  private _currentSession: PointerSession | null = null;
  private _debugCanvas: HTMLCanvasElement | null = null;
  private _isDirty: boolean = false;

  // runtime data
  private _isClick: boolean = false;
  private _clickCenter: BABYLON.Vector2 | null = null;
  private _line: BABYLON.LinesMesh | null = null;
  private _filteredPoints: any[] = [];
  private _meshPoints: BABYLON.Vector3[] = [];

  private _debugIsDirty = false;

  public init(
    canvas: HTMLCanvasElement,
    debugCanvas: HTMLCanvasElement,
    babylon: BabylonController
  ) {
    this._target = canvas;
    this._debugCanvas = debugCanvas;
    this._babylon = babylon;

    this._hammer = new Hammerjs(this._target, {
      // NOTE: Default touchAction value 'manipulation' will cause bug in chrome
      // See: https://github.com/hammerjs/hammer.js/issues/1084
      touchAction: 'none'
    });

    defaultHammerRecognizerNames.forEach(name => {
      const recognizer = this._hammer && this._hammer.get(name);
      // Turn off all default recognizers
      if (recognizer) {
        recognizer.set({ enable: false });
      }
    });

    this._hammer.on('hammer.input', e => {
      if (!this._currentSession || e.isFirst) {
        this._currentSession = new PointerSession();
      }

      this._currentSession.addInputPoint(e);

      if (e.isFirst) {
        this._onSessionStart(this._currentSession);
      }

      this._onSessionUpdate(this._currentSession);

      if (e.isFinal) {
        this._onSessionEnd(this._currentSession);
      }

      this._debugIsDirty = true;
    });
  }

  public update() {
    if (!this._babylon || !this._babylon.isInited || !this._debugIsDirty) {
      return;
    }

    const scene = this._babylon.scene as BABYLON.Scene;
    const points: BABYLON.Vector3[] = [];
    if (this._currentSession) {
      const camera = this._babylon.camera as BABYLON.Camera;
      const pm = camera.getProjectionMatrix();
      const vm = camera.getViewMatrix();
      const cm = vm.clone().multiply(pm);
      const cmInverse = cm.invert();
      const target = this._target as HTMLCanvasElement;

      this._filteredPoints.forEach(input => {
        // transform points
        const v = new BABYLON.Vector3(
          (input.x * 2) / target.clientWidth - 1,
          (-1 * (input.y * 2)) / target.clientHeight + 1,
          0
        );
        const p = BABYLON.Vector3.TransformCoordinates(v, cmInverse);
        p.z = 0;
        points.push(p);
      });
    }

    if (this._line) {
      this._line.dispose();
    }

    this._line = BABYLON.Mesh.CreateLines('debugLine', points, scene);
    this._line.color = new BABYLON.Color3(0.5, 0.5, 0.5);

    this.updateDebugCanvas();
  }

  public updateDebugCanvas() {
    if (!this._debugIsDirty || !this._debugCanvas) {
      return;
    }

    this._debugIsDirty = false;

    const ctx = this._debugCanvas.getContext('2d');

    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, this._debugCanvas.width, this._debugCanvas.height);

    if (this._currentSession) {
      // Draw points
      ctx.save();
      if (this._currentSession.isEnded) {
        ctx.fillStyle = '#00FFFF';
      } else {
        ctx.fillStyle = '#FF0000';
      }
      ctx.strokeStyle = 'red';
      const dotSize = 3;

      this._filteredPoints.forEach((input: any) => {
        ctx.fillRect(
          input.x - dotSize / 2,
          input.y - dotSize / 2,
          dotSize,
          dotSize
        );

        const normal = input.normal as BABYLON.Vector2;

        // draw normal
        ctx.beginPath();
        ctx.moveTo(input.x, input.y);
        ctx.lineTo(input.x + normal.x * 10, input.y + normal.y * 10);
        ctx.stroke();
      });
      ctx.restore();

      // Draw info
      ctx.save();

      ctx.restore();
    }
  }

  private _onSessionStart(session: PointerSession) {
    this._isClick = true;
    this._filteredPoints = [];
    this._meshPoints = [];
  }

  // Process data to do effect
  private _onSessionUpdate(session: PointerSession) {
    if (!this._currentSession) {
      return;
    }

    // determine if it is a click or swipe
    if (this._currentSession.traveledDistance > MIN_SWIPE_THRESHOLD) {
      this._isClick = false;

      // do some switch stuff
      // console.log('swipe');
    }

    /**
     * Filter points:
     * The first and the last (2 ends) are always added. Internal points only add
     * when the length is exceed a certain threshold
     */
    const inputDataList = this._currentSession.inputData;
    const currentInput = inputDataList[inputDataList.length - 1];
    const filteredPoint = {
      x: currentInput.center.x,
      y: currentInput.center.y,
      input: currentInput,
      traveledDistance: this._currentSession.traveledDistance,
      distanceToLast: 0,
      isStart: false,
      isEnd: true,
      normal: new BABYLON.Vector2(0, 0)
    };
    let lastFilteredPoint = null;
    let lastDeterminedPoint = null;

    // start point
    if (!this._filteredPoints.length) {
      filteredPoint.isStart = true;
      this._filteredPoints.push(filteredPoint);
    } else {
      lastFilteredPoint = this._filteredPoints[this._filteredPoints.length - 1];
    }

    // update lastFiltered to current if last is not long enough
    if (!filteredPoint.isStart && lastFilteredPoint) {
      if (lastFilteredPoint.isEnd === true) {
        if (lastFilteredPoint.isStart) {
          lastDeterminedPoint = lastFilteredPoint;
        } else {
          lastDeterminedPoint = this._filteredPoints[
            this._filteredPoints.length - 2
          ];
        }
      }

      const distanceDelta =
        filteredPoint.traveledDistance - lastDeterminedPoint.traveledDistance;

      if (distanceDelta > MIN_SWIPE_SEG || lastFilteredPoint.isStart) {
        lastFilteredPoint.isEnd = false;
        this._filteredPoints.push(filteredPoint);
      } else {
        this._filteredPoints[
          this._filteredPoints.length - 1 /* last one */
        ] = filteredPoint;
      }
    }

    // TODO: smooth path

    /**
     * Make normals for swipe
     * Normal defines the width expension for the swipe line
     */
    if (!this._isClick) {
      // only last 2 points normals will be affected
      const currentFP = this._filteredPoints[this._filteredPoints.length - 1];
      const lastFP = this._filteredPoints[this._filteredPoints.length - 2];

      if (currentFP && lastFP) {
        const currentV = new BABYLON.Vector2(
          currentFP.x - lastFP.x,
          currentFP.y - lastFP.y
        ).normalize();

        // Get perpendicular counter-clockwise, as current normal
        const currentFPNormal = currentFP.normal as BABYLON.Vector2;
        currentFPNormal.set(-currentV.y, currentV.x).normalize();

        // // last normal correction
        // const lastFPNormal = lastFP.normal as BABYLON.Vector2;

        // if (lastFPNormal.length() > 0.001) {
        //   // If it is not the start point

        // }
      }
    }
  }

  private _onSessionEnd(session: PointerSession) {}
}

export default new PointerEffect();
