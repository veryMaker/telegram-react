import React from 'react';
import './InlineKeyboard.css';

class InlineKeyboard extends React.Component {
    render() {
        if (this.props.replyMarkup['@type'] !== 'replyMarkupInlineKeyboard') return null;

        const keyboard = this.props.replyMarkup.rows.map(row => {
            const buttons = row.map(btn => {
                let onClick = null;
                let disabled = true;

                switch (btn.type['@type']) {
                    case 'inlineKeyboardButtonTypeBuy':
                        break;
                    case 'inlineKeyboardButtonTypeCallback':
                        break;
                    case 'inlineKeyboardButtonTypeCallbackGame':
                        break;
                    case 'inlineKeyboardButtonTypeSwitchInline':
                        break;
                    case 'inlineKeyboardButtonTypeUrl':
                        disabled = false;
                        onClick = () => {
                            window.open(btn.type.url, '_blank');
                        };
                        break;
                }

                return (
                    <button className='inline-keyboard-btn' onClick={onClick} disabled={disabled}>
                        {btn.text}
                    </button>
                );
            });

            return <div className='inline-keyboard-row'>{buttons}</div>;
        });

        return <div className='inline-keyboard'>{keyboard}</div>;
    }
}

export default InlineKeyboard;
