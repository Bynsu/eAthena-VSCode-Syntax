export function concatBuf(bufs: ArrayBuffer[]) {
    let len: number,
        bufViews: Uint8Array[] = [],
        newBuf: ArrayBuffer,
        index = -1,
        newBufView: Uint8Array;

    for (let buf of bufs) {
        len += buf.byteLength;
        bufViews.push(new Uint8Array(buf));
    }

    newBuf = new ArrayBuffer(len);
    newBufView = new Uint8Array(newBuf);

    for (let bufView of bufViews) {
        bufView.forEach((value) => newBufView[++index])
    }

    return newBuf;
}

export function bufToStr(buf: ArrayBuffer) {
    let bufView = new Uint16Array(buf);
    let str: string = '';

    bufView.forEach(value => str += String.fromCharCode(value));
    return str;
}

export function strToBuf (str: string) {
    return new ArrayBuffer(str.length * 2);
}

export function findIdx(table, val) {
    if (table[0] > val)
        return -1;

    let l = 0, r = table.length;
    while (l < r-1) { // always table[l] <= val < table[r]
        let mid = l + Math.floor((r-l+1)/2);
        if (table[mid] <= val)
            l = mid;
        else
            r = mid;
    }
    return l;
}