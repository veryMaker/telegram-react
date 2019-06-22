class MessageFormat {
    static format(html) {
        html = html
            .replace(/<div>/gi, '<br>')
            .replace(/<\/div>/gi, '<br>')
            .replace(/(<br ?\/?>)+/gi, '\n'); // replace multiple br to one \n

        const xml = new DOMParser().parseFromString(html, 'text/html');

        const newEntity = (type, offset, len) => {
            return {
                '@type': 'textEntity',
                offset: offset,
                length: len,
                type: type
            };
        };

        const getEntityType = xml => {
            if (xml.tagName) {
                switch (xml.tagName.toLowerCase()) {
                    case 'b':
                        return {
                            '@type': 'textEntityTypeBold'
                        };
                    case 'i':
                        return {
                            '@type': 'textEntityTypeItalic'
                        };
                    case 'pre':
                        return {
                            '@type': 'textEntityTypePre'
                        };
                    case 'code':
                        return {
                            '@type': 'textEntityTypeCode'
                        };

                    case 'a':
                        if (xml.innerHTML && xml.getAttribute('href')) {
                            return {
                                '@type': 'textEntityTypeTextUrl',
                                url: xml.getAttribute('href')
                            };
                        }
                }
            }

            return null;
        };

        const isNewLine = c => {
            return c === '\n' || c === '\r';
        };

        const xmlToString = (xml, result) => {
            const children = xml.childNodes;

            if (!children.length) {
                if (xml.textContent) {
                    const textContent = xml.textContent
                        .replace(/ +/g, ' ')
                        .replace(/\t+/g, '\t')
                        .replace(/(\r\n)+/g, '\r\n') // for Windows
                        .replace(/\r+/g, '\r') // for Mac OS 9 and prior
                        .replace(/\n+/g, '\n'); // for everything else

                    if (isNewLine(textContent) && isNewLine(result.text.charAt(result.pos - 1))) return;

                    result.text += textContent;
                    result.pos += textContent.length;
                }
                return;
            }

            const offset = result.pos;

            for (let child of children) {
                xmlToString(child, result);
            }

            const len = result.pos - offset;

            const entityType = getEntityType(xml);
            if (entityType) {
                result.entities.push(newEntity(entityType, offset, len));
            }
        };

        const result = {
            text: '',
            pos: 0,
            entities: []
        };

        xmlToString(xml, result);

        return result;
    }
}

export default MessageFormat;
