import React, { Component } from 'react';
import './RecordingTimer.css';

class RecordingTimer extends Component {
    constructor(props) {
        super(props);
        this.timerID = null;
        this.state = {
            date: new Date()
        };
    }

    componentDidMount() {
        this.timerID = setInterval(() => this.tick(), 10);
    }

    componentWillUnmount() {
        clearInterval(this.timerID);
    }

    tick() {
        this.setState({
            date: new Date()
        });
    }

    render() {
        const doubleNumber = n => {
            const s = n.toString();
            if (s.length === 1) return '0' + s;
            return s;
        };

        if (!this.props.startDate) return;
        const deltaTime = this.state.date.getTime() - this.props.startDate.getTime();
        const ms = Math.floor((deltaTime % 1000) / 10);
        const seconds = Math.floor((deltaTime / 1000) % 60);
        const minutes = Math.floor((deltaTime / (1000 * 60)) % 60);
        const content = doubleNumber(minutes) + ':' + doubleNumber(seconds) + ',' + ms;

        return (
            <div className='recording-timer-container'>
                <div className='recording-timer-circle' />
                {content}
            </div>
        );
    }
}

export default RecordingTimer;
