/*
 *  Copyright (c) 2018-present, Evgeny Nadymov
 *
 * This source code is licensed under the GPL v.3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { Component } from 'react';
import classNames from 'classnames';
import { compose } from 'recompose';
import emojiRegex from 'emoji-regex';
import Recorder from 'opus-recorder';
import RecordRTC from 'recordrtc';
import { getTracks } from 'recordrtc';
import jsmediatags from 'jsmediatags';
import sanitizeHtml from 'sanitize-html';
import { withTranslation } from 'react-i18next';
import withStyles from '@material-ui/core/styles/withStyles';
import SendIcon from '@material-ui/icons/Send';
import KeyboardVoiceIcon from '@material-ui/icons/KeyboardVoice';
import VideocamIcon from '@material-ui/icons/Videocam';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import InsertEmoticonIcon from '@material-ui/icons/InsertEmoticon';
import AttachButton from './../ColumnMiddle/AttachButton';
import CreatePollDialog from '../Dialog/CreatePollDialog';
import RecordingTimer from './../ColumnMiddle/RecordingTimer';
import IconButton from '@material-ui/core/IconButton';
import InputBoxHeader from './InputBoxHeader';
import OutputTypingManager from '../../Utils/OutputTypingManager';
import { getSize, readImageSize } from '../../Utils/Common';
import { getChatDraft, getChatDraftReplyToMessageId, isMeChat, isPrivateChat } from '../../Utils/Chat';
import { borderStyle } from '../Theme';
import MessageFormat from '../../Utils/MessageFormat';
import { PHOTO_SIZE } from '../../Constants';
import MessageStore from '../../Stores/MessageStore';
import ChatStore from '../../Stores/ChatStore';
import ApplicationStore from '../../Stores/ApplicationStore';
import FileStore from '../../Stores/FileStore';
import StickerStore from '../../Stores/StickerStore';
import TdLibController from '../../Controllers/TdLibController';
import './InputBoxControl.css';
import ContentEditable from 'react-contenteditable';

const EmojiPickerButton = React.lazy(() => import('./../ColumnMiddle/EmojiPickerButton'));

const styles = theme => ({
    iconButton: {
        margin: '8px 0'
    },
    closeIconButton: {
        margin: 0
    },
    ...borderStyle(theme)
});

class InputBoxControl extends Component {
    constructor(props) {
        super(props);

        this.attachDocumentRef = React.createRef();
        this.attachMediaRef = React.createRef();
        this.newMessageRef = React.createRef();
        this.recordButtonRef = React.createRef();
        this.canvasRef = React.createRef();

        const chatId = ApplicationStore.getChatId();
        this.sanitizeConfig = {
            allowedTags: ['b', 'i', 'a', 'br', 'div'],
            allowedAttributes: {
                a: ['href']
            },
            transformTags: {
                em: 'i',
                strong: 'b',
                p: 'div',
                li: 'div'
            }
        };

        this.audioRecorder = null;
        this.videoRecorder = null;
        this.stream = null;
        this.video = null;
        this.canvasContext = null;
        this.canvasStream = null;
        this.needSendRecord = false;
        this.startRecordTimer = 0;

        this.state = {
            chatId: chatId,
            replyToMessageId: getChatDraftReplyToMessageId(chatId),
            openPasteDialog: false,
            innerHTML: '',
            recordStartDate: null,
            isAudioRecord: true
        };
    }

    componentDidMount() {
        //console.log('Perf componentDidMount');

        ApplicationStore.on('clientUpdateChatId', this.onClientUpdateChatId);
        MessageStore.on('clientUpdateReply', this.onClientUpdateReply);
        StickerStore.on('clientUpdateStickerSend', this.onClientUpdateStickerSend);
        window.addEventListener('mouseup', this.handleRecordMouseUp);

        this.setInputFocus();
        this.setDraft();
        this.suggestStickers();
    }

    componentWillUnmount() {
        const newChatDraftMessage = this.getNewChatDraftMessage(this.state.chatId, this.state.replyToMessageId);
        this.setChatDraftMessage(newChatDraftMessage);

        clearTimeout(this.startRecordTimer);
        if (this.audioRecorder) {
            this.audioRecorder.ondataavailable = null;
            this.audioRecorder.stop();
            this.audioRecorder = null;
        }
        this.stopRecordVideo(false);
        if (this.stream) {
            this.stream.stop();
            this.stream = null;
        }

        ApplicationStore.removeListener('clientUpdateChatId', this.onClientUpdateChatId);
        MessageStore.removeListener('clientUpdateReply', this.onClientUpdateReply);
        StickerStore.removeListener('clientUpdateStickerSend', this.onClientUpdateStickerSend);
        window.removeEventListener('mouseup', this.handleRecordMouseUp);
    }

    onClientUpdateStickerSend = update => {
        const { sticker: item } = update;
        if (!item) return;

        const { sticker, thumbnail, width, height } = item;
        if (!sticker) return;

        this.setState({ innerHTML: '' });

        const content = {
            '@type': 'inputMessageSticker',
            sticker: {
                '@type': 'inputFileId',
                id: sticker.id
            },
            width,
            height
        };

        if (thumbnail) {
            const { width: thumbnailWidth, height: thumbnailHeight, photo } = thumbnail;

            content.thumbnail = {
                thumbnail: {
                    '@type': 'inputFileId',
                    id: photo.id
                },
                width: thumbnailWidth,
                height: thumbnailHeight
            };
        }

        this.onSendInternal(content, true, result => {});

        TdLibController.clientUpdate({
            '@type': 'clientUpdateLocalStickersHint',
            hint: null
        });
    };

    onClientUpdateReply = update => {
        const { chatId: currentChatId } = this.state;
        const { chatId, messageId } = update;

        if (currentChatId !== chatId) {
            return;
        }

        this.setState({ replyToMessageId: messageId });

        if (messageId) {
            this.setInputFocus();
        }
    };

    onClientUpdateChatId = update => {
        const { chatId } = this.state;
        if (chatId === update.nextChatId) return;

        this.setState({
            innerHTML: '',
            chatId: update.nextChatId,
            replyToMessageId: getChatDraftReplyToMessageId(update.nextChatId),
            openPasteDialog: false
        });
    };

    setDraft = () => {
        const { chatId } = this.state;

        const draft = getChatDraft(chatId);
        if (draft) {
            this.setState({ innerHTML: draft.text });
        } else {
            this.setState({ innerHTML: '' });
        }
    };

    componentDidUpdate(prevProps, prevState, snapshot) {
        //console.log('Perf componentDidUpdate');
        this.setChatDraftMessage(snapshot);

        if (prevState.chatId !== this.state.chatId) {
            this.setInputFocus();
            this.setDraft();
            this.suggestStickers();
        } else if (prevState.innerHTML !== this.state.innerHTML) {
            this.suggestStickers();
        }
    }

    getSnapshotBeforeUpdate(prevProps, prevState) {
        if (prevState.chatId === this.state.chatId) return null;

        return this.getNewChatDraftMessage(prevState.chatId, prevState.replyToMessageId);
    }

    setInputFocus = () => {
        setTimeout(() => {
            if (this.newMessageRef.current) {
                this.newMessageRef.current.focus();
            }
        }, 100);
    };

    setChatDraftMessage = chatDraftMessage => {
        if (!chatDraftMessage) return;

        const { chatId, draftMessage } = chatDraftMessage;
        if (!chatId) return;

        TdLibController.send({
            '@type': 'setChatDraftMessage',
            chat_id: chatId,
            draft_message: draftMessage
        });
    };

    getNewChatDraftMessage = (chatId, replyToMessageId) => {
        let chat = ChatStore.get(chatId);
        if (!chat) return;
        const newDraft = this.getInputText();

        let previousDraft = '';
        let previousReplyToMessageId = 0;
        const { draft_message } = chat;
        if (draft_message && draft_message.input_message_text && draft_message.input_message_text.text) {
            const { reply_to_message_id, input_message_text } = draft_message;

            previousReplyToMessageId = reply_to_message_id;
            if (input_message_text && input_message_text.text) {
                previousDraft = input_message_text.text.text;
            }
        }

        if (newDraft !== previousDraft || replyToMessageId !== previousReplyToMessageId) {
            const draftMessage = {
                '@type': 'draftMessage',
                reply_to_message_id: replyToMessageId,
                input_message_text: {
                    '@type': 'inputMessageText',
                    text: {
                        '@type': 'formattedText',
                        text: newDraft,
                        entities: null
                    },
                    disable_web_page_preview: true,
                    clear_draft: false
                }
            };

            return { chatId: chatId, draftMessage: draftMessage };
        }

        return null;
    };

    handleSubmit = () => {
        const formatted = MessageFormat.format(this.newMessageRef.current.innerHTML);

        if (!formatted.text.trim()) return;

        this.setState({ innerHTML: '' });

        const content = {
            '@type': 'inputMessageText',
            text: {
                '@type': 'formattedText',
                text: formatted.text,
                entities: formatted.entities
            },
            disable_web_page_preview: false,
            clear_draft: true
        };

        this.onSendInternal(content, false, result => {});
    };

    handleAttachPoll = () => {
        TdLibController.clientUpdate({
            '@type': 'clientUpdateNewPoll'
        });
    };

    handleAttachMedia = () => {
        if (!this.attachMediaRef) return;

        this.attachMediaRef.current.click();
    };

    handleAttachMediaComplete = () => {
        let files = this.attachMediaRef.current.files;
        if (files.length === 0) return;

        Array.from(files).forEach(file => {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.mp3') || fileName.endsWith('.flac')) {
                this.handleSendAudio(file);
            } else if (fileName.endsWith('.mp4')) {
                this.handleSendVideo(file, file.name);
            } else {
                readImageSize(file, result => {
                    this.handleSendPhoto(result);
                });
            }
        });

        this.attachMediaRef.current.value = '';
    };

    handleAttachDocument = () => {
        if (!this.attachDocumentRef) return;

        this.attachDocumentRef.current.click();
    };

    handleAttachDocumentComplete = () => {
        let files = this.attachDocumentRef.current.files;
        if (files.length === 0) return;

        Array.from(files).forEach(file => {
            this.handleSendDocument(file);
        });

        this.attachDocumentRef.current.value = '';
    };

    handleAttachLocation = () => {
        navigator.geolocation.getCurrentPosition(
            position => {
                const content = {
                    '@type': 'inputMessageLocation',
                    location: {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    },
                    live_period: 0
                };

                this.onSendInternal(content, true, () => {});
            },
            error => console.error(error)
        );
    };

    isRecording() {
        return this.state.recordStartDate !== null;
    }

    isRecordingSupported() {
        return Recorder.isRecordingSupported();
    }

    handleRecordMouseDown = e => {
        if (this.state.recordStartDate !== null) {
            this.stopRecord(true);
        } else {
            this.startRecordTimer = setTimeout(this.startRecord, 300);
        }
    };

    handleRecordMouseUp = e => {
        const isRecordButton = this.recordButtonRef.current && this.recordButtonRef.current.contains(e.target);

        if (this.startRecordTimer) {
            if (isRecordButton) {
                clearTimeout(this.startRecordTimer);
                this.startRecordTimer = 0;
                this.setState(state => ({ isAudioRecord: !state.isAudioRecord }));
            }
        } else {
            this.stopRecord(isRecordButton);
        }
    };

    startRecord = () => {
        this.startRecordTimer = 0;
        if (this.state.isAudioRecord) {
            this.startRecordAudio();
        } else {
            this.startRecordVideo();
        }
    };

    stopRecord = needSendRecord => {
        this.needSendRecord = needSendRecord;
        if (this.state.isAudioRecord) {
            this.stopRecordAudio();
        } else {
            this.stopRecordVideo(this.needSendRecord);
        }
    };

    startRecordVideo = () => {
        if (!this.videoRecorder) {
            navigator.mediaDevices
                .getUserMedia({
                    video: true,
                    audio: true
                })
                .then(stream => {
                    this.stream = stream;

                    this.video = document.createElement('video');
                    this.video.volume = 0;
                    this.video.autoplay = true;
                    this.video.playsinline = true;
                    this.video.srcObject = stream;

                    const canvas = this.canvasRef.current;
                    this.canvasContext = canvas.getContext('2d');
                    this.canvasContext.fillStyle = '#ffffff';
                    this.canvasContext.fillRect(0, 0, 240, 240);
                    this.canvasContext.beginPath();
                    this.canvasContext.ellipse(120, 120, 120, 120, 0, 0, Math.PI * 2);
                    this.canvasContext.clip();
                    this.canvasStream = canvas.captureStream();

                    const audioPlusCanvasStream = new MediaStream();

                    getTracks(this.canvasStream, 'video').forEach(videoTrack => {
                        audioPlusCanvasStream.addTrack(videoTrack);
                    });

                    getTracks(stream, 'audio').forEach(audioTrack => {
                        audioPlusCanvasStream.addTrack(audioTrack);
                    });

                    this.videoRecorder = RecordRTC(audioPlusCanvasStream, {
                        type: 'video',
                        mimeType: 'video/mp4'
                    });
                    this.videoRecorder.startRecording();
                    this.setState({ recordStartDate: new Date() });

                    requestAnimationFrame(this.drawVideoFrame);
                })
                .catch(err => console.log('Can not get video stream', err));
        }
    };

    drawVideoFrame = () => {
        if (this.videoRecorder === null) return;

        const w = this.video.videoWidth;
        const h = this.video.videoHeight;
        const scaleX = 240 / w;
        const scaleY = 240 / h;
        const scale = Math.max(scaleX, scaleY);

        this.canvasContext.drawImage(this.video, -(w * scale - 240) / 2, -(h * scale - 240) / 2, w * scale, h * scale);

        requestAnimationFrame(this.drawVideoFrame);
    };

    stopRecordVideo = needSendRecord => {
        if (this.videoRecorder) {
            this.videoRecorder.stopRecording(() => {
                const blob = this.videoRecorder.getBlob();
                const fileName = new Date().toISOString() + '.mp4';

                this.video.src = this.video.srcObject = null;
                this.stream.stop();
                this.stream = null;
                this.canvasStream.stop();
                this.canvasStream = null;
                this.canvasContext.clearRect(0, 0, 240, 240);
                this.videoRecorder.destroy();
                this.videoRecorder = null;
                this.recordDuration = Math.floor((new Date().getTime() - this.state.recordStartDate.getTime()) / 1000);
                this.setState({ recordStartDate: null });

                if (needSendRecord) {
                    this.handleSendVideoNote(blob, fileName, this.recordDuration);
                }
            });
        }
    };

    startRecordAudio = () => {
        if (!this.audioRecorder) {
            this.audioRecorder = new Recorder({
                monitorGain: 0,
                numberOfChannels: 1,
                bitRate: 35300,
                encoderSampleRate: 48000
            });
            this.audioRecorder.ondataavailable = this.handleAudioRecordDataAvailable;
        }

        navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then(stream => {
                this.stream = stream;
                this.audioRecorder.start(stream);
                this.setState({ recordStartDate: new Date() });
            })
            .catch(err => console.log('Can not get audio stream', err));
    };

    handleAudioRecordDataAvailable = typedArray => {
        this.stream.stop();
        this.stream = null;
        if (this.needSendRecord) {
            const blob = new Blob([typedArray], { type: 'audio/ogg' });
            const fileName = new Date().toISOString() + '.ogg';
            this.handleSendVoiceNote(blob, fileName, this.recordDuration);
        }
    };

    stopRecordAudio = () => {
        if (this.audioRecorder && this.isRecording()) {
            this.recordDuration = Math.floor((new Date().getTime() - this.state.recordStartDate.getTime()) / 1000);
            this.setState({ recordStartDate: null });
            this.audioRecorder.stop();
        }
    };

    getInputText() {
        return this.newMessageRef.current ? this.newMessageRef.current.innerText : '';
    }

    handleKeyUp = e => {
        const { chatId } = this.state;

        if (isMeChat(chatId)) return;

        const chat = ChatStore.get(chatId);
        if (!chat) return;

        const innerText = this.getInputText();

        if (!innerText) return;

        const typingManager = chat.OutputTypingManager || (chat.OutputTypingManager = new OutputTypingManager(chat.id));

        typingManager.setTyping({ '@type': 'chatActionTyping' });
    };

    handleKeyDown = e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) {
                document.execCommand('insertText', false, '\n');
            } else {
                this.handleSubmit();
            }
        } else if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
            document.execCommand('bold', false);
            e.preventDefault();
        } else if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
            document.execCommand('italic', false);
            e.preventDefault();
        } else if (e.key === 'u' && (e.ctrlKey || e.metaKey)) {
            const url = prompt('Please enter URL', 'https://');
            if (url != null) {
                document.execCommand('createLink', false, url);
            }
            e.preventDefault();
        }
    };

    handleSendPhoto = file => {
        if (!file) return;

        const content = {
            '@type': 'inputMessagePhoto',
            photo: { '@type': 'inputFileBlob', name: file.name, data: file },
            width: file.photoWidth,
            height: file.photoHeight
        };

        this.onSendInternal(content, true, result => {
            const cachedMessage = MessageStore.get(result.chat_id, result.id);
            if (cachedMessage != null) {
                this.handleSendingMessage(cachedMessage, file);
            }

            FileStore.uploadFile(result.content.photo.sizes[0].photo.id, result);
        });
    };

    handleSendPoll = poll => {
        this.onSendInternal(poll, true, () => {});
    };

    handleSendDocument = (file, fileName) => {
        if (!file) return;

        const content = {
            '@type': 'inputMessageDocument',
            document: { '@type': 'inputFileBlob', name: fileName || file.name, data: file }
        };

        this.onSendInternal(content, true, result => FileStore.uploadFile(result.content.document.document.id, result));
    };

    getAudioInfo = (file, callback) => {
        const handleMetaData = () => {
            audio.removeEventListener('loadedmetadata', handleMetaData);

            const handleTag = tag => {
                const title = tag.tags.title || file.name;
                const performer = tag.tags.artist || '';
                const pic = tag.tags.picture
                    ? {
                          thumbnail: {
                              '@type': 'inputFileBlob',
                              name: file.name + '.jpg',
                              data: tag.tags.picture.data
                          },
                          width: 0,
                          height: 0
                      }
                    : null;

                callback({
                    '@type': 'inputMessageAudio',
                    audio: { '@type': 'inputFileBlob', name: file.name, data: file },
                    album_cover_thumbnail: pic,
                    duration: Math.floor(audio.duration),
                    title: title,
                    performer: performer
                });
            };

            jsmediatags.read(file, {
                onSuccess: handleTag,
                onError: function(error) {
                    console.log(':(', error.type, error.info);
                    handleTag({ tags: {} });
                }
            });
        };

        const audio = new Audio();
        audio.addEventListener('loadedmetadata', handleMetaData);
        audio.src = window.URL.createObjectURL(file);
    };

    handleSendAudio = file => {
        if (!file) return;

        this.getAudioInfo(file, content => {
            this.onSendInternal(content, true, result => FileStore.uploadFile(result.content.audio.audio.id, result));
        });
    };

    handleSendVoiceNote = (file, fileName, duration) => {
        if (!file) return;

        const content = {
            '@type': 'inputMessageVoiceNote',
            voice_note: { '@type': 'inputFileBlob', name: fileName, data: file },
            duration: duration
        };

        this.onSendInternal(content, true, result => FileStore.uploadFile(result.content.voice_note.voice.id, result));
    };

    getVideoInfo = (file, fileName, callback) => {
        const video = document.createElement('video');
        video.volume = 0;
        video.playsinline = true;

        const handleTimeUpdate = () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);

            const canvas = document.createElement('canvas');
            const canvasContext = canvas.getContext('2d');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            canvas.toBlob(
                blob => {
                    callback({
                        thumbnail: {
                            thumbnail: { '@type': 'inputFileBlob', name: fileName + '.jpg', data: blob },
                            width: video.videoWidth,
                            height: video.videoHeight
                        },
                        width: video.videoWidth,
                        height: video.videoHeight,
                        duration: Math.floor(video.duration)
                    });
                },
                'image/jpeg',
                0.5
            );
        };

        const handleMetaData = () => {
            video.removeEventListener('loadedmetadata', handleMetaData);
            video.addEventListener('timeupdate', handleTimeUpdate);
            video.currentTime = 0;
        };

        video.addEventListener('loadedmetadata', handleMetaData);
        video.src = window.URL.createObjectURL(file);
    };

    handleSendVideo = (file, fileName) => {
        if (!file) return;

        this.getVideoInfo(file, fileName, info => {
            const content = {
                '@type': 'inputMessageVideo',
                video: { '@type': 'inputFileBlob', name: fileName, data: file },
                thumbnail: info.thumbnail,
                duration: info.duration,
                width: info.width,
                height: info.height,
                supports_streaming: false,
                ttl: 0
            };

            this.onSendInternal(content, true, result => {
                const cachedMessage = MessageStore.get(result.chat_id, result.id);
                if (cachedMessage != null) {
                    this.handleSendingMessage(cachedMessage, file);
                }

                FileStore.uploadFile(result.content.video.video.id, result);
            });
        });
    };

    handleSendVideoNote = (file, fileName, duration) => {
        if (!file) return;

        this.getVideoInfo(file, fileName, info => {
            const content = {
                '@type': 'inputMessageVideoNote',
                video_note: { '@type': 'inputFileBlob', name: fileName, data: file },
                thumbnail: info.thumbnail,
                duration: duration,
                length: info.width
            };

            this.onSendInternal(content, true, result => {
                const cachedMessage = MessageStore.get(result.chat_id, result.id);
                if (cachedMessage != null) {
                    this.handleSendingMessage(cachedMessage, file);
                }

                FileStore.uploadFile(result.content.video_note.video.id, result);
            });
        });
    };

    handlePaste = event => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;

        const files = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind.indexOf('file') === 0) {
                files.push(items[i].getAsFile());
            }
        }

        if (files.length > 0) {
            event.preventDefault();

            this.files = files;
            this.setState({ openPasteDialog: true });
            return;
        }

        const htmlData = event.clipboardData.getData('text/html');
        if (htmlData) {
            event.preventDefault();
            const s = sanitizeHtml(htmlData, this.sanitizeConfig);

            document.execCommand('insertHTML', false, s);
        }
    };

    handlePasteContinue = () => {
        this.handleClosePaste();

        const files = this.files;
        if (!files) return;
        if (!files.length) return;

        files.forEach(file => {
            this.handleSendDocument(file);
        });

        this.files = null;
    };

    handleClosePaste = () => {
        this.setState({ openPasteDialog: false });
    };

    handleSendingMessage = (message, blob) => {
        if (message && message.sending_state && message.sending_state['@type'] === 'messageSendingStatePending') {
            if (message.content && message.content['@type'] === 'messagePhoto' && message.content.photo) {
                let size = getSize(message.content.photo.sizes, PHOTO_SIZE);
                if (!size) return;

                let file = size.photo;
                if (file && file.local && file.local.is_downloading_completed && !file.blob) {
                    file.blob = blob;
                    FileStore.updatePhotoBlob(message.chat_id, message.id, file.id);
                }
            }
        }
    };

    onSendInternal = async (content, clearDraft, callback) => {
        const { chatId, replyToMessageId } = this.state;

        if (!chatId) return;
        if (!content) return;

        try {
            await ApplicationStore.invokeScheduledAction(`clientUpdateClearHistory chatId=${chatId}`);

            let result = await TdLibController.send({
                '@type': 'sendMessage',
                chat_id: chatId,
                reply_to_message_id: replyToMessageId,
                input_message_content: content
            });

            this.setState({ replyToMessageId: 0 }, () => {
                if (clearDraft) {
                    const newChatDraftMessage = this.getNewChatDraftMessage(
                        this.state.chatId,
                        this.state.replyToMessageId
                    );
                    this.setChatDraftMessage(newChatDraftMessage);
                }
            });
            //MessageStore.set(result);

            TdLibController.send({
                '@type': 'viewMessages',
                chat_id: chatId,
                message_ids: [result.id]
            });

            callback(result);
        } catch (error) {
            alert('sendMessage error ' + JSON.stringify(error));
        }
    };

    handleEmojiSelect = emoji => {
        if (!emoji) return;
        document.execCommand('insertText', false, emoji.native);
    };

    handleChange = e => {
        this.setState({ innerHTML: e.target.value });
    };

    suggestStickers = async event => {
        const innerText = this.getInputText().trimRight();
        if (!innerText || innerText.length > 11) {
            const { hint } = StickerStore;
            if (hint) {
                TdLibController.clientUpdate({
                    '@type': 'clientUpdateLocalStickersHint',
                    hint: null
                });
            }

            return;
        }

        const t0 = performance.now();
        const regex = emojiRegex();
        let match = regex.exec(innerText);
        const t1 = performance.now();
        console.log('Matched ' + (t1 - t0) + 'ms', match);
        if (!match || innerText !== match[0]) {
            const { hint } = StickerStore;
            if (hint) {
                TdLibController.clientUpdate({
                    '@type': 'clientUpdateLocalStickersHint',
                    hint: null
                });
            }

            return;
        }

        const timestamp = Date.now();
        TdLibController.send({
            '@type': 'getStickers',
            emoji: match[0],
            limit: 100
        }).then(stickers => {
            TdLibController.clientUpdate({
                '@type': 'clientUpdateLocalStickersHint',
                hint: {
                    timestamp,
                    emoji: match[0],
                    stickers
                }
            });
        });

        TdLibController.send({
            '@type': 'searchStickers',
            emoji: match[0],
            limit: 100
        }).then(stickers => {
            TdLibController.clientUpdate({
                '@type': 'clientUpdateRemoteStickersHint',
                hint: {
                    timestamp,
                    emoji: match[0],
                    stickers
                }
            });
        });
    };

    render() {
        const { classes, t } = this.props;
        const { chatId, replyToMessageId, openPasteDialog } = this.state;

        return (
            <>
                <div className={classNames(classes.borderColor, 'inputbox')}>
                    <InputBoxHeader chatId={chatId} messageId={replyToMessageId} />
                    <div className='inputbox-wrapper'>
                        {this.isRecording() ? (
                            <div className='inputbox-recording-column'>
                                <RecordingTimer startDate={this.state.recordStartDate} />
                                <div className='inputbox-recording-column-text'>Release outside to cancel</div>
                            </div>
                        ) : (
                            <>
                                <div className='inputbox-left-column'>
                                    <input
                                        ref={this.attachDocumentRef}
                                        className='inputbox-attach-button'
                                        type='file'
                                        multiple='multiple'
                                        onChange={this.handleAttachDocumentComplete}
                                    />
                                    <input
                                        ref={this.attachMediaRef}
                                        className='inputbox-attach-button'
                                        type='file'
                                        multiple='multiple'
                                        accept='image/*, video/mp4, audio/mp3, audio/flac'
                                        onChange={this.handleAttachMediaComplete}
                                    />
                                    <AttachButton
                                        chatId={chatId}
                                        onAttachMedia={this.handleAttachMedia}
                                        onAttachDocument={this.handleAttachDocument}
                                        onAttachLocation={this.handleAttachLocation}
                                        onAttachPoll={this.handleAttachPoll}
                                    />
                                </div>
                                <div className='inputbox-middle-column'>
                                    <ContentEditable
                                        id='inputbox-message'
                                        innerRef={this.newMessageRef}
                                        placeholder={t('Message')}
                                        html={this.state.innerHTML}
                                        onKeyDown={this.handleKeyDown}
                                        onKeyUp={this.handleKeyUp}
                                        onPaste={this.handlePaste}
                                        onChange={this.handleChange}
                                    />
                                </div>
                                <div className='inputbox-btn-column'>
                                    <React.Suspense
                                        fallback={
                                            <IconButton className={classes.iconButton} aria-label='Emoticon'>
                                                <InsertEmoticonIcon />
                                            </IconButton>
                                        }>
                                        <EmojiPickerButton onSelect={this.handleEmojiSelect} />
                                    </React.Suspense>
                                </div>
                            </>
                        )}
                        <div className='inputbox-btn-column'>
                            {this.getInputText().trim().length === 0 && this.isRecordingSupported() ? (
                                <IconButton
                                    className={classes.iconButton}
                                    aria-label='Mic'
                                    buttonRef={this.recordButtonRef}
                                    onMouseDown={this.handleRecordMouseDown}>
                                    {this.state.isAudioRecord ? <KeyboardVoiceIcon /> : <VideocamIcon />}
                                </IconButton>
                            ) : (
                                <IconButton
                                    className={classes.iconButton}
                                    aria-label='Send'
                                    onClick={this.handleSubmit}>
                                    <SendIcon />
                                </IconButton>
                            )}
                        </div>
                    </div>
                </div>
                {!isPrivateChat(chatId) && <CreatePollDialog onSend={this.handleSendPoll} />}
                <Dialog
                    transitionDuration={0}
                    open={openPasteDialog}
                    onClose={this.handleClosePaste}
                    aria-labelledby='delete-dialog-title'>
                    <DialogTitle id='delete-dialog-title'>{t('AppName')}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {this.files && this.files.length > 1
                                ? 'Are you sure you want to send files?'
                                : 'Are you sure you want to send file?'}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={this.handleClosePaste} color='primary'>
                            {t('Cancel')}
                        </Button>
                        <Button onClick={this.handlePasteContinue} color='primary'>
                            {t('Ok')}
                        </Button>
                    </DialogActions>
                </Dialog>

                <canvas
                    ref={this.canvasRef}
                    style={{ display: this.isRecording() && !this.state.isAudioRecord ? 'block' : 'none' }}
                    width='240'
                    height='240'
                    className='video-note-record'
                />
            </>
        );
    }
}

const enhance = compose(
    withStyles(styles, { withTheme: true }),
    withTranslation()
);

export default enhance(InputBoxControl);
