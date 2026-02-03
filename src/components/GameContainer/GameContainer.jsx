import React, { Component } from 'react';
import ChooseCharacters from '../ChooseCharacters/ChooseCharacters';
import Game from '../Game/Game';

class GameContainer extends Component {
  state = {
    stage:1,
    isLocked: false,
    decidedGroups: JSON.parse(localStorage.getItem('decidedGroups') || null) || []
  }

  componentDidUpdate(prevProps) {
    // Only reset stage when moving back to chooseCharacters and not locked
    if(prevProps.gameState !== 'chooseCharacters' && this.props.gameState === 'chooseCharacters' && !this.state.isLocked) {
      this.setState({stage: 1});
    }
  }

  startGame = decidedGroups => {
    if(parseInt(this.state.stage)<1 || isNaN(parseInt(this.state.stage)))
      this.setState({stage: 1});

    this.setState({decidedGroups: decidedGroups});
    localStorage.setItem('decidedGroups', JSON.stringify(decidedGroups));
    this.props.handleStartGame();
  }

  stageUp = () => {
    this.setState({stage: this.state.stage+1});
  }

  lockStage = (stage, forceLock) => {
    // allow locking any stage number; preserve 5 as drawing stage
    if(forceLock)
      this.setState({stage: stage, isLocked: true});
    else
      this.setState({stage: stage, isLocked: !this.state.isLocked});
  }

  render() {
    return (
      <div>
        { this.props.gameState==='chooseCharacters' &&
            <ChooseCharacters selectedGroups={this.state.decidedGroups}
              handleStartGame={this.startGame}
              stage={this.state.stage}
              isLocked={this.state.isLocked}
              lockStage={this.lockStage}
            />
          }
          { this.props.gameState==='game' &&
              <Game decidedGroups={this.state.decidedGroups}
                handleEndGame={this.props.handleEndGame}
                stageUp={this.stageUp}
                stage={this.state.stage}
                isLocked={this.state.isLocked}
                lockStage={this.lockStage}
              />
          }
        </div>
    )
  }
}

export default GameContainer;
