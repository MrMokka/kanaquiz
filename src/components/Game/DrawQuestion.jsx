import React, { Component } from 'react';
import { kanaDictionary } from '../../data/kanaDictionary';
import { quizSettings } from '../../data/quizSettings';
import { removeFromArray, arrayContains, shuffle, findRomajisAtKanaKey } from '../../data/helperFuncs';

/*
Lightweight canvas drawing question for Stage 5 ("write the kana").
- Shows a target kana (same question selection logic as other stages)
- User draws on canvas; we compare the drawn bitmap against the target glyph
- For a simple, offline, no-font-metrics approach, we render the target glyph faintly on a hidden canvas and compare pixel overlap after normalization
- If similarity score >= threshold, mark correct, advance progress; else negative progress
*/

class DrawQuestion extends Component {
  state = {
    previousQuestion: [],
    previousAnswer: '',
    currentQuestion: [],
    stageProgress: 0,
    similarity: 0,
    showHint: false,
    // prompt type: 'kana' or 'romaji'
    promptType: 'kana',

    // result preview state
    resultShown: false,
    resultCorrect: false,
    resultScore: 0,
    resultPrecision: 0,
    resultRecall: 0,
    resultTargetURL: '',
    resultOverlayURL: '',

    // maps
    resultPrecisionMapURL: '',
    resultRecallMapURL: '',
    showPrecisionMap: false, // deprecated per new combined toggle
    showRecallMap: false,    // deprecated per new combined toggle
    showDebugMaps: false
  };

  componentDidMount() {
    this.initializeCharacters();
    // Initialize canvases before setting the first question so hidden target exists
    this.initCanvas();
    this.setNewQuestion();
  }

  componentWillUnmount() {
    // cleanup listeners if any
    if (this.canvas) {
      this.canvas.onpointerdown = null;
      this.canvas.onpointermove = null;
      this.canvas.onpointerup = null;
      this.canvas.onpointerleave = null;
    }
  }

  initializeCharacters() {
    this.askableKanas = {};
    this.askableKanaKeys = [];
    this.previousQuestion = '';
    this.previousAnswer = '';
    this.stageProgress = 0;
    Object.keys(kanaDictionary).forEach(whichKana => {
      Object.keys(kanaDictionary[whichKana]).forEach(groupName => {
        if(arrayContains(groupName, this.props.decidedGroups)) {
          this.askableKanas = Object.assign(this.askableKanas, kanaDictionary[whichKana][groupName]['characters']);
          Object.keys(kanaDictionary[whichKana][groupName]['characters']).forEach(key => {
            this.askableKanaKeys.push(key);
          });
        }
      });
    });
  }

  getRandomKanas(amount, include, exclude) {
    let randomizedKanas = this.askableKanaKeys.slice();
    if(exclude && exclude.length > 0) {
      randomizedKanas = removeFromArray(exclude, randomizedKanas);
    }
    shuffle(randomizedKanas);
    randomizedKanas = randomizedKanas.slice(0, amount);
    return randomizedKanas;
  }

  // Draw faint preview onto visible canvas if hint enabled
  drawHintOverlay() {
    if (!this.ctx || !this.hctx) return;
    if (!this.state.showHint) return;
    try {
      this.ctx.save();
      this.ctx.globalAlpha = 0.12;
      this.ctx.drawImage(this.hidden, 0, 0);
      this.ctx.restore();
    } catch (e) { /* ignore */ }
  }

  // Draw current ink layer onto visible canvas (over grid / hint)
  drawInkToVisible() {
    if (!this.ctx || !this.ictx) return;
    try {
      const inkImg = this.ictx.getImageData(0,0,this.ink.width,this.ink.height);
      const tmp = document.createElement('canvas');
      tmp.width = this.ink.width; tmp.height = this.ink.height;
      const tctx = tmp.getContext('2d');
      tctx.putImageData(inkImg, 0, 0);
      this.ctx.drawImage(tmp, 0, 0);
    } catch (e) { /* ignore */ }
  }

  // Clear only the visible canvas, preserve ink layer
  clearVisibleCanvas() {
    if (!this.ctx) return;
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    // light grid (visible only)
    this.ctx.strokeStyle = '#eee';
    this.ctx.lineWidth = 1;
    for(let i=1;i<4;i++){
      const x = (this.canvas.width/4)*i;
      const y = (this.canvas.height/4)*i;
      this.ctx.beginPath(); this.ctx.moveTo(x,0); this.ctx.lineTo(x,this.canvas.height); this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(this.canvas.width,y); this.ctx.stroke();
    }
  }

  // Existing method: clear both visible and ink
  clearCanvas = () => {
    if (!this.ctx) return;
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    if (this.ictx) this.ictx.clearRect(0,0,this.ink.width,this.ink.height);
    // light grid (visible only)
    this.ctx.strokeStyle = '#eee';
    this.ctx.lineWidth = 1;
    for(let i=1;i<4;i++){
      const x = (this.canvas.width/4)*i;
      const y = (this.canvas.height/4)*i;
      this.ctx.beginPath(); this.ctx.moveTo(x,0); this.ctx.lineTo(x,this.canvas.height); this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(this.canvas.width,y); this.ctx.stroke();
    }
  }

  // Recompose visible canvas: grid, optional hint, then ink
  recomposeVisible() {
    this.clearVisibleCanvas();
    this.drawHintOverlay();
    this.drawInkToVisible();
  }

  setNewQuestion() {
    this.currentQuestion = this.getRandomKanas(1, false, this.previousQuestion);
    this.setState({currentQuestion: this.currentQuestion});
    // Full clear for a new question
    this.clearCanvas();
    this.renderTargetToHidden();
    this.recomposeVisible();
  }

  initCanvas() {
    this.canvas = this.canvasRef;
    this.ctx = this.canvas.getContext('2d');
    // Hidden canvas for target glyph
    this.hidden = document.createElement('canvas');
    this.hidden.width = this.canvas.width;
    this.hidden.height = this.canvas.height;
    this.hctx = this.hidden.getContext('2d');
    // Hidden canvas for user ink only (no grid)
    this.ink = document.createElement('canvas');
    this.ink.width = this.canvas.width;
    this.ink.height = this.canvas.height;
    this.ictx = this.ink.getContext('2d');

    this.isDrawing = false;
    this.lastPt = null;

    const start = (e) => {
      if (this.state.resultShown) return; // disable drawing while results are shown
      this.isDrawing = true;
      this.lastPt = this.getPoint(e);
    };
    const move = (e) => {
      if(!this.isDrawing || this.state.resultShown) return;
      const p = this.getPoint(e);
      // draw on visible canvas (force solid black)
      this.ctx.save();
      this.ctx.globalAlpha = 1.0;
      this.ctx.strokeStyle = '#000';
      this.ctx.lineWidth = 10;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPt.x, this.lastPt.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this.ctx.restore();
      // draw on ink layer
      this.ictx.strokeStyle = '#000';
      this.ictx.lineWidth = 10;
      this.ictx.lineCap = 'round';
      this.ictx.beginPath();
      this.ictx.moveTo(this.lastPt.x, this.lastPt.y);
      this.ictx.lineTo(p.x, p.y);
      this.ictx.stroke();

      this.lastPt = p;
    };
    const end = () => {
      if (this.state.resultShown) return;
      this.isDrawing = false;
      // Do not auto-submit; user must click Submit to evaluate
    };

    this.canvas.onpointerdown = start;
    this.canvas.onpointermove = move;
    this.canvas.onpointerup = end;
    this.canvas.onpointerleave = end;

    // Initial paint should not wipe ink (none yet), but use visible clear
    this.clearVisibleCanvas();
    this.recomposeVisible();
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }


  renderTargetToHidden() {
    if (!this.hctx) return;
    this.hctx.clearRect(0,0,this.hidden.width,this.hidden.height);
    this.hctx.fillStyle = '#000';
    this.hctx.strokeStyle = '#000';
    this.hctx.textAlign = 'center';
    this.hctx.textBaseline = 'middle';
    const fontSize = Math.floor(this.hidden.height*0.7);
    this.hctx.font = `${fontSize}px "Hiragino Kaku Gothic Pro", "Meiryo", "MS PGothic", system-ui`;
    const kana = (this.currentQuestion && this.currentQuestion[0]) || (this.state.currentQuestion[0] || '');
    // Slightly wider outline for leniency
    this.hctx.lineWidth = Math.max(4, Math.floor(fontSize*0.03));
    this.hctx.strokeText(kana, this.hidden.width/2, this.hidden.height/2);
    this.hctx.globalAlpha = 0.15;
    this.hctx.fillText(kana, this.hidden.width/2, this.hidden.height/2);
    this.hctx.globalAlpha = 1.0;
  }

  // Compute bounding box of non-transparent pixels
  getBBox(imgData, width, height, alphaThresh=10) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    const data = imgData.data;
    for (let y=0; y<height; y++) {
      for (let x=0; x<width; x++) {
        const i = (y*width + x)*4;
        if (data[i+3] > alphaThresh) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null;
    return { x: minX, y: minY, w: (maxX-minX+1), h: (maxY-minY+1) };
  }

  // Build data URLs for result preview
  buildResultPreviews(drawnImgData) {
    try {
      // overlay: grid + softened target underlay + more visible raw ink on top
      const ovCanvas = document.createElement('canvas');
      ovCanvas.width = this.hidden.width; ovCanvas.height = this.hidden.height;
      const ovCtx = ovCanvas.getContext('2d');
      // draw light grid
      ovCtx.strokeStyle = '#eee'; ovCtx.lineWidth = 1;
      for(let i=1;i<4;i++){ const x=(ovCanvas.width/4)*i, y=(ovCanvas.height/4)*i; ovCtx.beginPath(); ovCtx.moveTo(x,0); ovCtx.lineTo(x,ovCanvas.height); ovCtx.stroke(); ovCtx.beginPath(); ovCtx.moveTo(0,y); ovCtx.lineTo(ovCanvas.width,y); ovCtx.stroke(); }
      // target underlay
      ovCtx.save(); ovCtx.globalAlpha = 0.10; ovCtx.drawImage(this.hidden, 0, 0); ovCtx.restore();
      // raw ink
      const inkImg = drawnImgData; // ImageData
      const inkCanvas = document.createElement('canvas'); inkCanvas.width = this.hidden.width; inkCanvas.height = this.hidden.height;
      inkCanvas.getContext('2d').putImageData(inkImg, 0, 0);
      ovCtx.save(); ovCtx.globalAlpha = 0.48; ovCtx.globalCompositeOperation = 'source-over'; ovCtx.drawImage(inkCanvas, 0, 0); ovCtx.restore();
      const overlayURL = ovCanvas.toDataURL();

      // Build precision and recall maps
      const targetImg = this.hctx.getImageData(0,0,this.hidden.width,this.hidden.height);
      const width = this.hidden.width, height = this.hidden.height;
      // Precision map: ink pixels colored by whether they hit target (green) or miss (red)
      const precCanvas = document.createElement('canvas'); precCanvas.width = width; precCanvas.height = height; const pctx = precCanvas.getContext('2d'); const pData = pctx.createImageData(width, height);
      // Recall map: target pixels colored by whether covered by ink (green) or uncovered (orange)
      const recCanvas = document.createElement('canvas'); recCanvas.width = width; recCanvas.height = height; const rctx = recCanvas.getContext('2d'); const rData = rctx.createImageData(width, height);
      const drawn = inkImg.data; const target = targetImg.data; const alphaThresh = 10;
      for (let i=0; i<drawn.length; i+=4) {
        const d = drawn[i+3] > alphaThresh; const t = target[i+3] > alphaThresh;
        // precision map only shows where d=true
        if (d) {
          if (t) { // hit: green
            pData.data[i] = 30; pData.data[i+1] = 200; pData.data[i+2] = 30; pData.data[i+3] = 180;
          } else { // miss: red
            pData.data[i] = 220; pData.data[i+1] = 40; pData.data[i+2] = 40; pData.data[i+3] = 180;
          }
        } else {
          // transparent
          pData.data[i] = 0; pData.data[i+1] = 0; pData.data[i+2] = 0; pData.data[i+3] = 0;
        }
        // recall map only shows where t=true
        if (t) {
          if (d) { // covered: green
            rData.data[i] = 30; rData.data[i+1] = 200; rData.data[i+2] = 30; rData.data[i+3] = 160;
          } else { // uncovered: orange
            rData.data[i] = 240; rData.data[i+1] = 140; rData.data[i+2] = 20; rData.data[i+3] = 160;
          }
        } else {
          rData.data[i] = 0; rData.data[i+1] = 0; rData.data[i+2] = 0; rData.data[i+3] = 0;
        }
      }
      pctx.putImageData(pData, 0, 0); rctx.putImageData(rData, 0, 0);
      const precisionMapURL = precCanvas.toDataURL(); const recallMapURL = recCanvas.toDataURL();

      this.setState({ resultTargetURL: '', resultOverlayURL: overlayURL, resultPrecisionMapURL: precisionMapURL, resultRecallMapURL: recallMapURL });
    } catch (e) { /* ignore */ }
  }

  computeSimilarity() {
    // Hybrid score using raw ink: precision (inter/ink) and recall (inter/target)
    try {
      const drawnImg = this.ictx.getImageData(0,0,this.ink.width,this.ink.height);
      const targetImg = this.hctx.getImageData(0,0,this.hidden.width,this.hidden.height);
      const drawn = drawnImg.data;
      const target = targetImg.data;
      let inter = 0, countDrawn = 0, countTarget = 0;
      const alphaThresh = 10;
      for (let i=0; i<drawn.length; i+=4) {
        const d = drawn[i+3] > alphaThresh;
        const t = target[i+3] > alphaThresh;
        if (d) countDrawn++;
        if (t) countTarget++;
        if (d && t) inter++;
      }
      const precision = countDrawn ? inter / countDrawn : 0;
      const recall = countTarget ? inter / countTarget : 0;
      const score = (0.7 * precision) + (0.3 * recall);
      // Enforce minimum recall to avoid trivial passes; then apply lenient score/precision
      const meetsRecall = recall >= 0.15;
      const isCorrect = meetsRecall && (score >= 0.4 || precision >= 0.55);
      this.setState({ similarity: score, resultShown: true, resultCorrect: isCorrect, resultScore: score, resultPrecision: precision, resultRecall: recall }, ()=>{
        if (this.nextBtnRef && this.nextBtnRef.scrollIntoView) {
          this.nextBtnRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      this.buildResultPreviews(drawnImg);
    } catch (e) {
      // ignore
    }
  }

  proceedNext() {
    const correct = this.state.resultCorrect;
    this.setState({ resultShown: false });
    this.onSubmit(correct);
  }

  onSubmit(correct) {
    this.previousQuestion = this.currentQuestion;
    this.setState({previousQuestion: this.previousQuestion});
    if(correct)
      this.stageProgress = this.stageProgress+1;
    else
      this.stageProgress = this.stageProgress > 0 ? this.stageProgress - 1 : 0;
    this.setState({stageProgress: this.stageProgress});
    if(this.stageProgress >= quizSettings.stageLength[5] && !this.props.isLocked) {
      setTimeout(() => { this.props.handleStageUp() }, 300);
    }
    else
      this.setNewQuestion();
  }

  // Helper: get prompt string based on selected type
  getPromptText() {
    const kana = (this.currentQuestion && this.currentQuestion[0]) || (this.state.currentQuestion[0] || '');
    if (this.state.promptType === 'romaji') {
      const arr = findRomajisAtKanaKey(kana, kanaDictionary);
      return (arr && arr[0]) || '';
    }
    return kana;
  }

  render() {
    const stageProgressPercentage = Math.round((this.state.stageProgress/quizSettings.stageLength[5])*100)+'%';
    const stageProgressPercentageStyle = { width: stageProgressPercentage };
    const kana = this.state.currentQuestion[0] || '';
    const canvasStyle = { border:'1px solid #ccc', touchAction:'none', pointerEvents: this.state.resultShown ? 'none' : 'auto' };
    const promptText = this.getPromptText();
    return (
      <div className="text-center question col-xs-12">
        <div className="previous-result none">Draw the character as accurately as you can.</div>
        <div style={{margin:'6px 0', opacity:0.15, fontSize:'72px'}}>{promptText}</div>
        <div>
          <canvas ref={c=>this.canvasRef=c} width={320} height={320} style={canvasStyle} />
        </div>
        {/* prompt type toggle */}
        <div style={{marginTop:6}}>
          <label style={{marginRight:12}}>
            <input type="radio" name="promptType" checked={this.state.promptType==='kana'} onChange={()=>this.setState({promptType:'kana'})} />
            &nbsp;Show kana
          </label>
          <label>
            <input type="radio" name="promptType" checked={this.state.promptType==='romaji'} onChange={()=>this.setState({promptType:'romaji'})} />
            &nbsp;Show romaji
          </label>
        </div>
        {/* hint toggle */}
        <div style={{marginTop:6}}>
          <label style={{cursor:'pointer', userSelect:'none'}}>
            <input type="checkbox" checked={this.state.showHint} onChange={(e)=>{ const checked = e.target.checked; this.setState({showHint: checked}, ()=>{ this.renderTargetToHidden(); this.recomposeVisible(); }); }} />
            &nbsp;Show hint (preview)
          </label>
        </div>
        {/* similarity and actions */}
        <div style={{marginTop:8}}>Similarity: {(this.state.similarity*100).toFixed(0)}%</div>
        {
          !this.state.resultShown ? (
            <div style={{marginTop:8}}>
              <button className="btn btn-default" onClick={()=>{ this.clearCanvas(); this.drawHintOverlay(); this.setState({similarity:0}); }}>Clear</button>
              <button className="btn btn-primary" style={{marginLeft:8}} onClick={()=>this.computeSimilarity()}>Submit</button>
            </div>
          ) : (
            <div style={{marginTop:8}}>
              <div className={this.state.resultCorrect ? 'previous-result correct' : 'previous-result wrong'} style={{marginBottom:8, fontWeight: 400}}>
                {this.state.resultCorrect ? 'Correct!' : 'Not quite.'} &nbsp;Score: {(this.state.resultScore*100).toFixed(0)}% &middot; Precision: {(this.state.resultPrecision*100).toFixed(0)}% &middot; Recall: {(this.state.resultRecall*100).toFixed(0)}%
              </div>
              <div style={{display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap'}}>
                <div>
                  <div className="text-muted" style={{marginBottom:4, fontWeight: 400}}>Your strokes (overlay)</div>
                  { this.state.resultOverlayURL && (
                    <div style={{width:160, height:160, border:'1px solid #ddd', borderRadius:2, overflow:'hidden', display:'inline-block'}}>
                      <img alt="Overlay" src={this.state.resultOverlayURL} width={160} height={160} />
                    </div>
                  )}
                  {/* Combined debug toggle under strokes */}
                  <div style={{marginTop:8}}>
                    <label style={{cursor:'pointer', fontWeight: 400}}>
                      <input type="checkbox" checked={this.state.showDebugMaps} onChange={(e)=>this.setState({showDebugMaps: e.target.checked})} />
                      &nbsp;Stroke debug maps
                    </label>
                  </div>
                </div>
                { this.state.showDebugMaps && (
                  <>
                    <div>
                      <div className="text-muted" style={{marginBottom:4, fontWeight: 400}}>Precision map</div>
                      { this.state.resultPrecisionMapURL && (
                        <div style={{width:160, height:160, border:'1px solid #ddd', borderRadius:2, overflow:'hidden', display:'inline-block'}}>
                          <img alt="Precision" src={this.state.resultPrecisionMapURL} width={160} height={160} />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-muted" style={{marginBottom:4, fontWeight: 400}}>Recall map</div>
                      { this.state.resultRecallMapURL && (
                        <div style={{width:160, height:160, border:'1px solid #ddd', borderRadius:2, overflow:'hidden', display:'inline-block'}}>
                          <img alt="Recall" src={this.state.resultRecallMapURL} width={160} height={160} />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div style={{marginTop:8, position:'sticky', bottom:12, zIndex:10}}>
                <button ref={c=>this.nextBtnRef=c} className="btn btn-primary" onClick={()=>this.proceedNext()}>Next</button>
              </div>
            </div>
          )
        }
        {/* progress bar */}
        <div className="progress" style={{marginTop:8}}>
          <div className="progress-bar progress-bar-info"
            role="progressbar"
            aria-valuenow={this.state.stageProgress}
            aria-valuemin="0"
            aria-valuemax={quizSettings.stageLength[5]}
            style={stageProgressPercentageStyle}
          >
            <span>Stage 5 (Write) {this.props.isLocked?' (Locked)':''}</span>
          </div>
        </div>
      </div>
    );
  }
}

export default DrawQuestion;
