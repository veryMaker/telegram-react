/*
 *  Copyright (c) 2018-present, Evgeny Nadymov
 *
 * This source code is licensed under the GPL v.3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';
import { getChatTitle, isChatVerified, isChatMuted } from '../../Utils/Chat';
import ChatStore from '../../Stores/ChatStore';
import './DialogTitleControl.css';
import NotificationsControl from '../ColumnMiddle/NotificationsControl';

class DialogTitleControl extends NotificationsControl {
    constructor(props) {
        super(props);
    }

    shouldComponentUpdate(nextProps, nextState) {
        if (nextProps.chatId !== this.props.chatId) {
            return true;
        }

        if (nextProps.t !== this.props.t) {
            return true;
        }

        if (nextState.isMuted !== this.state.isMuted) {
            return true;
        }

        return false;
    }

    componentDidMount() {
        super.componentDidMount();
        ChatStore.on('clientUpdateFastUpdatingComplete', this.onFastUpdatingComplete);
        ChatStore.on('updateChatTitle', this.onUpdateChatTitle);
    }

    componentWillUnmount() {
        super.componentWillUnmount();
        ChatStore.removeListener('clientUpdateFastUpdatingComplete', this.onFastUpdatingComplete);
        ChatStore.removeListener('updateChatTitle', this.onUpdateChatTitle);
    }

    onFastUpdatingComplete = update => {
        this.forceUpdate();
    };

    onUpdateChatTitle = update => {
        const { chatId } = this.props;

        if (update.chat_id !== chatId) return;

        this.forceUpdate();
    };

    render() {
        const { t, chatId, showSavedMessages } = this.props;

        const title = getChatTitle(chatId, showSavedMessages, t);
        const isVerified = isChatVerified(chatId);

        return (
            <div className='dialog-title'>
                {title}
                {isVerified ? <div className='verified-badge' /> : null}
                {this.state.isMuted ? <div className='muted-badge' /> : null}
            </div>
        );
    }
}

DialogTitleControl.propTypes = {
    chatId: PropTypes.number.isRequired,
    showSavedMessages: PropTypes.bool
};

DialogTitleControl.defaultProps = {
    showSavedMessages: true
};

export default withTranslation()(DialogTitleControl);
