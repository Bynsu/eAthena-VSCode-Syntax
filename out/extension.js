"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const fs = require("fs");
const iconv = require("iconv-lite");
const vscode = require("vscode");
let itemDB;
let mobDB;
let mobSkillDB;
let questDB;
let skillDB;
let skillCastDB;
let itemTradeDB;
let scriptFunctionDB = new Map();
let constDB = new Map();
let forceDbColumnHighlight = new Map();
let forceDbColumnHints = new Map();
let codepage = "win1252";
let is_rAthena = false;
const languageId = "eAthena";
const languageIdLowerCase = "eathena";
let documentToDecorationTypes = new Map();
let documentToAthenaDBFile = new Map();
// NOTE: need to change wordPattern in language-configuration.json if we change here
let wordPattern = new RegExp("(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\\"\\,\\<\\>\\/\\?\\s]+)");
let serverQuestDbPath;
let athenaDir;
let athenaNpcDir;
let athenaDbDir;
let wordSeparators;
let itemImageURL;
let mobImageURL;
let skillImageURL;
let webviewPanel;
let webviewPanelEditor;
let webviewPanelLineNum;
let webviewPanelActiveParam;
class AthenaConst {
    constructor(name, val) {
        this.name = name;
        this.val = val;
    }
}
function formatFileName(fn) {
    return fn.replace(/\\/g, "/").toLowerCase();
}
function fileNamesEqual(fn1, fn2) {
    return formatFileName(fn1) == formatFileName(fn2);
}
function getAutoLoadedDatabases() {
    return [itemDB, mobDB, questDB, skillDB, skillCastDB, mobSkillDB, itemTradeDB];
}
function initDocumentAthenaDbFile(document) {
    // In case of special databases we just update lines of existing files.
    let autoLoadedDatabases = getAutoLoadedDatabases();
    for (let i = 0; i < autoLoadedDatabases.length; i++) { // no foreach to allow preemptive return
        let dbFile = autoLoadedDatabases[i].findFileByFilePath(document.fileName);
        if (dbFile) {
            dbFile.updateLines(document.getText(), true);
            return dbFile;
        }
    }
    // Otherwise we create a new temporary DB and cache it
    // Guess DB type by file name
    let db;
    if (document.fileName.endsWith("item_db.txt") || document.fileName.endsWith("item_db2.txt"))
        db = new AthenaItemDB([document.fileName]);
    else if (document.fileName.endsWith("mob_db.txt") || document.fileName.endsWith("mob_db2.txt"))
        db = new AthenaMobDB([document.fileName]);
    else if (document.fileName.endsWith("quest_db.txt"))
        db = new AthenaQuestDB([document.fileName]);
    else if (document.fileName.endsWith("mob_skill_db.txt") || document.fileName.endsWith("mob_skill_db2.txt")) // needs to be before skill_db to avoid mistaking mob_skill_db for skill_db
        db = new AthenaMobSkillDB([document.fileName]);
    else if (document.fileName.endsWith("skill_db.txt"))
        db = new AthenaSkillDB(document.fileName);
    else if (document.fileName.endsWith("skill_cast_db.txt"))
        db = new AthenaSkillCastDB(document.fileName);
    else if (document.fileName.endsWith("item_trade.txt"))
        db = new AthenaItemTradeDB(document.fileName);
    else
        db = new AthenaDB([document.fileName]);
    documentToAthenaDBFile.set(document, db.files[0]);
    return db.files[0];
}
function ensureDocumentAthenaDbFile(document) {
    let autoLoadedDBs = getAutoLoadedDatabases();
    for (let i = 0; i < autoLoadedDBs.length; i++) {
        let f = autoLoadedDBs[i].findFileByFilePath(document.fileName);
        if (f)
            return f;
    }
    return documentToAthenaDBFile.get(document) || initDocumentAthenaDbFile(document);
}
function makeHTMLLink(visibleText, filePath, lineNum0based, position0based) {
    let uri = vscode.Uri.file(filePath);
    let filePathWithPosition = uri + "#" + (lineNum0based + 1);
    if (position0based)
        filePathWithPosition += "," + (position0based + 1);
    return "<a href='#' onclick='selectParameter(\"" + visibleText + "\");' id='" + visibleText + "'>" + visibleText + "</a>";
}
function makeMarkdownLink(visibleText, filePath, lineNum0based, position0based) {
    let uri = vscode.Uri.file(filePath);
    let filePathWithPosition = uri + "#" + (lineNum0based + 1);
    if (position0based)
        filePathWithPosition += "," + (position0based + 1);
    return "[" + visibleText + "](" + filePathWithPosition + ")";
}
function makeMarkdownLinkWithImage(dbLine, imageURL, height, width) {
    return makeMarkdownLink("![image](" + imageURL + "|height=" + height + ",width=" + width + " '" + dbLine.filePath + ":" + (dbLine.lineNum + 1) + "')", dbLine.filePath, dbLine.lineNum);
}
function isWhitespace(str) {
    for (let i = 0; i < str.length; i++)
        if (str.charAt(i) != ' ' && str.charAt(i) != '\t' && str.charAt(i) != '\r' && str.charAt(i) != '\n')
            return false;
    return true;
}
class AthenaDBLine {
    constructor(filePath, lineNum, line) {
        this.params = new Array(0);
        this.paramRanges = new Array(0);
        this.filePath = filePath;
        this.lineNum = lineNum;
        this.lineStr = line;
        let comment = false;
        let paramStart = 0;
        let i = 0;
        for (; i < line.length; i++) {
            if (i < line.length - 1 && line.charAt(i) == '/' && line.charAt(i + 1) == '/') {
                comment = true;
                break;
            }
            let c = line.charAt(i);
            if (c == '\"') {
                while (i < line.length) {
                    i++;
                    if (line.charAt(i) == '\"' && line.charAt(i - 1) != '\"')
                        break;
                }
            }
            else if (c == '{') {
                let curlyLevel = 1;
                while (curlyLevel > 0 && i < line.length) {
                    i++;
                    if (line.charAt(i) == '{')
                        curlyLevel++;
                    else if (line.charAt(i) == '}')
                        curlyLevel--;
                }
            }
            else if (c == ',') {
                this.params.push(line.substring(paramStart, i).trim());
                this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
                paramStart = i + 1;
            }
        }
        if (comment) {
            // Whitespace before comment goes to "comment" as well
            do {
                i--;
            } while (i >= 0 && isWhitespace(line.charAt(i)));
            i++; // Skip last non-whitespace character
            if (paramStart != 0) {
                this.params.push(line.substring(paramStart, i).trim());
                this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
            }
            this.comment = line.substring(i);
        }
        else if (paramStart != 0) {
            this.params.push(line.substring(paramStart, i).trim());
            this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
        }
    }
    getParamByIndex(index) {
        return index < this.params.length ? this.params[index] : undefined;
    }
    getIntParamByIndex(index) {
        let val = this.getParamByIndex(index);
        return val ? parseInt(val) : undefined;
    }
    getParamIdxAtPosition(position) {
        for (let i = 0; i < this.paramRanges.length; i++)
            if (this.paramRanges[i].contains(position))
                return i;
        return undefined;
    }
}
class AthenaDBFile {
    constructor(parentDb, filePath) {
        if (!fs.existsSync(filePath)) {
            let error = "AthenaDB: " + filePath + " not exists";
            vscode.window.showErrorMessage(error);
            throw new Error(error);
        }
        this.parentDb = parentDb;
        this.filePath = filePath;
        this.lines = [];
        this.symbols = [];
        let fileContentBytes = fs.readFileSync(filePath);
        let fileContent = iconv.decode(fileContentBytes, codepage);
        this.updateLines(fileContent, false);
    }
    createLine(filePath, lineNum, line) {
        return new AthenaDBLine(filePath, lineNum, line);
    }
    updateLine(document, lineNum) {
        if (lineNum >= this.lines.length) {
            this.updateLines(document.getText(), true);
            return;
        }
        let newLine = this.createLine(this.filePath, lineNum, document.lineAt(lineNum).text);
        let prevLine = this.lines[lineNum];
        let prevKey = prevLine.getParamByIndex(this.parentDb.keyIndex);
        let newKey = newLine.getParamByIndex(this.parentDb.keyIndex);
        if (prevKey != newKey) {
            this.updateLines(document.getText(), true);
            return;
        }
        this.lines[lineNum] = newLine;
        // Update index if needed
        if (prevKey) {
            let iPrevKey = parseInt(prevKey);
            if (prevLine == this.parentDb.idToDbLine.get(iPrevKey)) {
                this.parentDb.idToDbLine.set(iPrevKey, newLine);
                let prevName = prevLine.getParamByIndex(this.parentDb.nameIndex);
                let newName = newLine.getParamByIndex(this.parentDb.nameIndex);
                if (prevName)
                    this.parentDb.nameToDbLine.delete(prevName);
                if (newName)
                    this.parentDb.nameToDbLine.set(newName, newLine);
            }
        }
    }
    updateLines(text, rebuildParentDbIndex) {
        this.lines = new Array(0);
        let strLines = text.split('\n');
        for (let i = 0; i < strLines.length; i++) {
            let dbLine = this.createLine(this.filePath, i, strLines[i]);
            this.lines.push(dbLine);
        }
        this.symbols = [];
        this.lines.forEach(l => {
            let label = this.parentDb.getSymbolLabelForLine(l);
            if (label) {
                // let symbol = new vscode.SymbolInformation(label,
                // 	vscode.SymbolKind.Variable,
                // 	this.filePath,
                // 	new vscode.Location(vscode.Uri.file(this.filePath), new vscode.Range(l.paramRanges[0].start, l.paramRanges[l.paramRanges.length-1].end)));
                let range = new vscode.Range(l.paramRanges[0].start, l.paramRanges[l.paramRanges.length - 1].end);
                let symbol = new vscode.SymbolInformation(label, vscode.SymbolKind.Variable, range, vscode.Uri.file(this.filePath));
                this.symbols.push(symbol);
            }
        });
        if (rebuildParentDbIndex)
            this.parentDb.rebuildIndex();
    }
    getParamIdxAtPosition(position) {
        if (position.line < 0 || position.line >= this.lines.length)
            return undefined;
        let line = this.lines[position.line];
        return line.getParamIdxAtPosition(position);
    }
}
class AthenaDB {
    constructor(filePaths, lineDef, keyIndex, nameIndex) {
        this.idToDbLine = new Map();
        this.nameToDbLine = new Map();
        this.alreadyExplainingLine = false; // to display short descriptions for each param if explaining line
        let startTime = new Date().getTime();
        this.files = [];
        this.keyIndex = keyIndex || 0;
        this.nameIndex = nameIndex || 1;
        // Initialize
        filePaths.forEach(filePath => {
            this.files.push(this.createFile(this, filePath));
        });
        // Set parameter names
        if (lineDef)
            this.paramNames = lineDef.split(',');
        else {
            let testLines = this.files[0].lines;
            let isLineDefOnNextLine = false;
            let paramNamesLine = null;
            for (let i = 0; i < 20 && i < testLines.length - 1; i++) {
                let lineText = testLines[i].lineStr;
                if ((isLineDefOnNextLine || i == 0) && lineText.startsWith("//") && lineText.includes(",")) {
                    paramNamesLine = lineText.trim();
                    break;
                }
                else if (lineText.toLowerCase().startsWith("// structure of database")) {
                    isLineDefOnNextLine = true;
                    continue;
                }
            }
            if (paramNamesLine)
                this.paramNames = paramNamesLine.substr(2).trim().split(",");
            else
                this.paramNames = new Array();
            for (let i = 0; i < this.paramNames.length; i++)
                this.paramNames[i] = this.paramNames[i].trim();
        }
        this.rebuildIndex();
        this.constructionTime = new Date().getTime() - startTime;
    }
    createFile(db, filePath) {
        return new AthenaDBFile(db, filePath);
    }
    rebuildIndex() {
        this.idToDbLine.clear();
        this.nameToDbLine.clear();
        this.files.forEach(f => {
            f.lines.forEach(l => {
                if (this.keyIndex < l.params.length && l.params[this.keyIndex])
                    this.idToDbLine.set(parseInt(l.params[this.keyIndex]), l);
                if (this.nameIndex < l.params.length)
                    this.nameToDbLine.set(l.params[this.nameIndex].trim(), l);
            });
        });
    }
    getParamIndex(paramName) {
        for (let i = 0; i < this.paramNames.length; i++)
            if (this.paramNames[i] == paramName)
                return i;
        return -1;
    }
    tryGetParamOfLineByKey(key, paramName) {
        const line = this.idToDbLine.get(key);
        if (line == undefined)
            return "";
        for (let i = 0; i < line.params.length && i < this.paramNames.length; i++)
            if (paramName === this.paramNames[i])
                return line.params[i];
        return "";
    }
    explainParamByLineSub(line, paramIdx, modifiedValue, html) {
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : ("param_" + paramIdx);
        let position = line.paramRanges[paramIdx].start;
        let unmodifiedParamVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (unmodifiedParamVal == modifiedValue) {
            let iParamVal = parseInt(modifiedValue);
            if (iParamVal.toString() == modifiedValue)
                modifiedValue = iParamVal.toLocaleString();
        }
        return html ?
            makeHTMLLink(paramName, line.filePath, position.line, position.character) + ": " + modifiedValue
            : makeMarkdownLink(paramName, line.filePath, position.line, position.character) + " : " + modifiedValue;
    }
    explainParamByLine(line, paramIdx, html) {
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        let iParamVal = parseInt(paramVal);
        if (iParamVal.toString() == paramVal)
            paramVal = iParamVal.toLocaleString();
        return this.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    explainLine(line, html, cursorPosition) {
        this.alreadyExplainingLine = true;
        let maxLength = Math.max(this.paramNames.length, line.params.length);
        let ret = "";
        if (html)
            ret += `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Athena Line Preview</title>
			</head>
			<body>`;
        let activeParam = undefined;
        if (cursorPosition != undefined)
            activeParam = line.getParamIdxAtPosition(cursorPosition);
        for (let i = 0; i < maxLength; i++) {
            let paramVal = (i < line.params.length) ? line.params[i].trim() : "";
            if (!paramVal || paramVal == "{}")
                continue;
            if (i != 0)
                ret += html ? "<br>" : "  \n";
            if (html && activeParam != undefined && i == activeParam)
                ret += "<b>";
            ret += this.explainParamByLine(line, i, html);
            if (html && activeParam != undefined && i == activeParam)
                ret += "</b>";
        }
        this.alreadyExplainingLine = false;
        if (html)
            ret += `
			<script>
			const vscode = acquireVsCodeApi();

			function selectParameter(paramName) {
				vscode.postMessage({
					command: 'selectParameter',
					text: paramName
				});
			};
			</script>
			</body>
				</html>`;
        return ret;
    }
    findFileByFilePath(filePath) {
        return this.files.find(f => {
            let ret = fileNamesEqual(f.filePath, filePath);
            return ret;
        });
    }
    getSymbolLabelForLine(l) {
        let id = l.getParamByIndex(this.keyIndex);
        let name = l.getParamByIndex(this.nameIndex);
        if (id && name)
            return id + ":" + name.trim();
        else
            return undefined;
    }
    getParamDocumentation(paramIdx) {
        return undefined;
    }
    // hexType = 0: show only decimal
    // hexType = 1: show only hex
    // hexType = 2: show hex and decimal
    enumToParamDocumentation(typeEnum, hexType) {
        let paramDocumentation = "";
        for (let member in typeEnum) {
            if (parseInt(member).toString() == member) { // is number
                let num = parseInt(member);
                paramDocumentation += typeEnum[num] + " = ";
                if (hexType == 0)
                    paramDocumentation += num;
                else if (hexType == 1)
                    paramDocumentation += "0x" + num.toString(16);
                else
                    paramDocumentation += "0x" + num.toString(16) + " (" + num + ")";
                paramDocumentation += "  \n";
            }
        }
        return paramDocumentation;
    }
}
var AthenaItemTradeDBTradeMask;
(function (AthenaItemTradeDBTradeMask) {
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NODROP"] = 1] = "NODROP";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NOTRADE"] = 2] = "NOTRADE";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["ALLOW_PARTNER_TRADE"] = 4] = "ALLOW_PARTNER_TRADE";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NOSELLNPC"] = 8] = "NOSELLNPC";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NOCART"] = 16] = "NOCART";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NOSTORAGE"] = 32] = "NOSTORAGE";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["NOGUILDSTORAGE"] = 64] = "NOGUILDSTORAGE";
    AthenaItemTradeDBTradeMask[AthenaItemTradeDBTradeMask["ALLOW_DROP_INSTANCE_TRANSFER"] = 128] = "ALLOW_DROP_INSTANCE_TRANSFER";
})(AthenaItemTradeDBTradeMask || (AthenaItemTradeDBTradeMask = {}));
var rAthenaItemTradeDBTradeMask;
(function (rAthenaItemTradeDBTradeMask) {
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NODROP"] = 1] = "NODROP";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOTRADE"] = 2] = "NOTRADE";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["ALLOW_PARTNER_TRADE"] = 4] = "ALLOW_PARTNER_TRADE";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOSELLNPC"] = 8] = "NOSELLNPC";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOCART"] = 16] = "NOCART";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOSTORAGE"] = 32] = "NOSTORAGE";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOGUILDSTORAGE"] = 64] = "NOGUILDSTORAGE";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOMAIL"] = 128] = "NOMAIL";
    rAthenaItemTradeDBTradeMask[rAthenaItemTradeDBTradeMask["NOAUCTION"] = 256] = "NOAUCTION";
})(rAthenaItemTradeDBTradeMask || (rAthenaItemTradeDBTradeMask = {}));
var AthenaItemTradeDBColumns;
(function (AthenaItemTradeDBColumns) {
    AthenaItemTradeDBColumns[AthenaItemTradeDBColumns["ItemId"] = 0] = "ItemId";
    AthenaItemTradeDBColumns[AthenaItemTradeDBColumns["TradeMask"] = 1] = "TradeMask";
    AthenaItemTradeDBColumns[AthenaItemTradeDBColumns["GmOverride"] = 2] = "GmOverride";
})(AthenaItemTradeDBColumns || (AthenaItemTradeDBColumns = {}));
class AthenaItemTradeDB extends AthenaDB {
    constructor(fileName) {
        super([fileName || (athenaDbDir + "/item_trade.txt")]);
    }
    explainParamByLine(line, paramIdx, html) {
        let paramVal = line.getParamByIndex(paramIdx);
        if (!paramVal)
            return "";
        if (paramIdx == AthenaItemTradeDBColumns.ItemId) {
            paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine, html);
        }
        else if (paramIdx == AthenaItemTradeDBColumns.TradeMask) {
            paramVal = explainBinMaskEnumParam(paramVal, is_rAthena ? rAthenaItemTradeDBTradeMask : AthenaItemTradeDBTradeMask);
        }
        return super.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    getParamDocumentation(paramIdx) {
        if (paramIdx == AthenaItemTradeDBColumns.TradeMask)
            return this.enumToParamDocumentation(is_rAthena ? rAthenaItemTradeDBTradeMask : AthenaItemTradeDBTradeMask, 0);
    }
}
var EQP;
(function (EQP) {
    EQP[EQP["HEAD_LOW"] = 1] = "HEAD_LOW";
    EQP[EQP["HAND_R"] = 2] = "HAND_R";
    EQP[EQP["GARMENT"] = 4] = "GARMENT";
    EQP[EQP["ACC_L"] = 8] = "ACC_L";
    EQP[EQP["ARMOR"] = 16] = "ARMOR";
    EQP[EQP["HAND_L"] = 32] = "HAND_L";
    EQP[EQP["SHOES"] = 64] = "SHOES";
    EQP[EQP["ACC_R"] = 128] = "ACC_R";
    EQP[EQP["HEAD_TOP"] = 256] = "HEAD_TOP";
    EQP[EQP["HEAD_MID"] = 512] = "HEAD_MID";
    EQP[EQP["HEAD_TOP_COSTUME"] = 1024] = "HEAD_TOP_COSTUME";
    EQP[EQP["HEAD_MID_COSTUME"] = 2048] = "HEAD_MID_COSTUME";
    EQP[EQP["HEAD_LOW_COSTUME"] = 4096] = "HEAD_LOW_COSTUME";
    EQP[EQP["GARMENT_COSTUME"] = 8192] = "GARMENT_COSTUME";
    //LOCATION_COSTUME_FLOOR= 0x00004000,
    EQP[EQP["AMMO"] = 32768] = "AMMO";
    EQP[EQP["ARMOR_COSTUME"] = 65536] = "ARMOR_COSTUME";
    EQP[EQP["HAND_R_COSTUME"] = 131072] = "HAND_R_COSTUME";
    EQP[EQP["HAND_L_COSTUME"] = 262144] = "HAND_L_COSTUME";
    EQP[EQP["SHOES_COSTUME"] = 524288] = "SHOES_COSTUME";
    EQP[EQP["ACC_L_COSTUME"] = 1048576] = "ACC_L_COSTUME";
    EQP[EQP["ACC_R_COSTUME"] = 2097152] = "ACC_R_COSTUME";
})(EQP || (EQP = {}));
;
var IT_rA;
(function (IT_rA) {
    IT_rA[IT_rA["HEALING"] = 0] = "HEALING";
    IT_rA[IT_rA["UNKNOWN"] = 1] = "UNKNOWN";
    IT_rA[IT_rA["USABLE"] = 2] = "USABLE";
    IT_rA[IT_rA["ETC"] = 3] = "ETC";
    IT_rA[IT_rA["WEAPON"] = 4] = "WEAPON";
    IT_rA[IT_rA["ARMOR"] = 5] = "ARMOR";
    IT_rA[IT_rA["CARD"] = 6] = "CARD";
    IT_rA[IT_rA["PETEGG"] = 7] = "PETEGG";
    IT_rA[IT_rA["PETARMOR"] = 8] = "PETARMOR";
    IT_rA[IT_rA["UNKNOWN2"] = 9] = "UNKNOWN2";
    IT_rA[IT_rA["AMMO"] = 10] = "AMMO";
    IT_rA[IT_rA["DELAYCONSUME"] = 11] = "DELAYCONSUME";
    IT_rA[IT_rA["SHADOWGEAR"] = 12] = "SHADOWGEAR";
    //IT_ARMORMB			= 0x0d
    //IT_ARMORTMB			= 0x0e
    //IT_GUN				= 0x0f
    //IT_AMMO				= 0x10
    IT_rA[IT_rA["THROWWEAPON"] = 17] = "THROWWEAPON";
    IT_rA[IT_rA["CASH"] = 18] = "CASH";
    IT_rA[IT_rA["CANNONBALL"] = 19] = "CANNONBALL";
    IT_rA[IT_rA["MAX"] = 20] = "MAX";
})(IT_rA || (IT_rA = {}));
;
var IT;
(function (IT) {
    IT[IT["HEALING"] = 0] = "HEALING";
    IT[IT["UNKNOWN"] = 1] = "UNKNOWN";
    IT[IT["USABLE"] = 2] = "USABLE";
    IT[IT["ETC"] = 3] = "ETC";
    IT[IT["WEAPON"] = 4] = "WEAPON";
    IT[IT["ARMOR"] = 5] = "ARMOR";
    IT[IT["CARD"] = 6] = "CARD";
    IT[IT["PETEGG"] = 7] = "PETEGG";
    IT[IT["PETARMOR"] = 8] = "PETARMOR";
    IT[IT["UNKNOWN2"] = 9] = "UNKNOWN2";
    IT[IT["AMMO"] = 10] = "AMMO";
    IT[IT["DELAYCONSUME"] = 11] = "DELAYCONSUME";
    IT[IT["SHADOWGEAR"] = 12] = "SHADOWGEAR";
    //IT_ARMORMB			= 0x0d
    //IT_ARMORTMB			= 0x0e
    //IT_GUN				= 0x0f
    //IT_AMMO				= 0x10
    IT[IT["THROWWEAPON"] = 17] = "THROWWEAPON";
    IT[IT["CASH"] = 18] = "CASH";
    IT[IT["CANNONBALL"] = 19] = "CANNONBALL";
    IT[IT["MAX"] = 20] = "MAX";
})(IT || (IT = {}));
;
function getITEnumType() {
    return is_rAthena ? IT_rA : IT;
}
var JOB;
(function (JOB) {
    JOB[JOB["NOVICE"] = 0] = "NOVICE";
    JOB[JOB["SWORDMAN"] = 1] = "SWORDMAN";
    JOB[JOB["MAGE"] = 2] = "MAGE";
    JOB[JOB["ARCHER"] = 3] = "ARCHER";
    JOB[JOB["ACOLYTE"] = 4] = "ACOLYTE";
    JOB[JOB["MERCHANT"] = 5] = "MERCHANT";
    JOB[JOB["THIEF"] = 6] = "THIEF";
    JOB[JOB["KNIGHT"] = 7] = "KNIGHT";
    JOB[JOB["PRIEST"] = 8] = "PRIEST";
    JOB[JOB["WIZARD"] = 9] = "WIZARD";
    JOB[JOB["BLACKSMITH"] = 10] = "BLACKSMITH";
    JOB[JOB["HUNTER"] = 11] = "HUNTER";
    JOB[JOB["ASSASSIN"] = 12] = "ASSASSIN";
    JOB[JOB["KNIGHT2"] = 13] = "KNIGHT2";
    JOB[JOB["CRUSADER"] = 14] = "CRUSADER";
    JOB[JOB["MONK"] = 15] = "MONK";
    JOB[JOB["SAGE"] = 16] = "SAGE";
    JOB[JOB["ROGUE"] = 17] = "ROGUE";
    JOB[JOB["ALCHEMIST"] = 18] = "ALCHEMIST";
    JOB[JOB["BARD"] = 19] = "BARD";
    JOB[JOB["DANCER"] = 20] = "DANCER";
    JOB[JOB["CRUSADER2"] = 21] = "CRUSADER2";
    JOB[JOB["WEDDING"] = 22] = "WEDDING";
    JOB[JOB["SUPER_NOVICE"] = 23] = "SUPER_NOVICE";
    JOB[JOB["GUNSLINGER"] = 24] = "GUNSLINGER";
    JOB[JOB["NINJA"] = 25] = "NINJA";
    JOB[JOB["XMAS"] = 26] = "XMAS";
    JOB[JOB["SUMMER"] = 27] = "SUMMER";
    JOB[JOB["HANBOK"] = 28] = "HANBOK";
    JOB[JOB["OKTOBERFEST"] = 29] = "OKTOBERFEST";
    JOB[JOB["SUMMER2"] = 30] = "SUMMER2";
    JOB[JOB["MAX_BASIC"] = 31] = "MAX_BASIC";
    JOB[JOB["NOVICE_HIGH"] = 4001] = "NOVICE_HIGH";
    JOB[JOB["SWORDMAN_HIGH"] = 4002] = "SWORDMAN_HIGH";
    JOB[JOB["MAGE_HIGH"] = 4003] = "MAGE_HIGH";
    JOB[JOB["ARCHER_HIGH"] = 4004] = "ARCHER_HIGH";
    JOB[JOB["ACOLYTE_HIGH"] = 4005] = "ACOLYTE_HIGH";
    JOB[JOB["MERCHANT_HIGH"] = 4006] = "MERCHANT_HIGH";
    JOB[JOB["THIEF_HIGH"] = 4007] = "THIEF_HIGH";
    JOB[JOB["LORD_KNIGHT"] = 4008] = "LORD_KNIGHT";
    JOB[JOB["HIGH_PRIEST"] = 4009] = "HIGH_PRIEST";
    JOB[JOB["HIGH_WIZARD"] = 4010] = "HIGH_WIZARD";
    JOB[JOB["WHITESMITH"] = 4011] = "WHITESMITH";
    JOB[JOB["SNIPER"] = 4012] = "SNIPER";
    JOB[JOB["ASSASSIN_CROSS"] = 4013] = "ASSASSIN_CROSS";
    JOB[JOB["LORD_KNIGHT2"] = 4014] = "LORD_KNIGHT2";
    JOB[JOB["PALADIN"] = 4015] = "PALADIN";
    JOB[JOB["CHAMPION"] = 4016] = "CHAMPION";
    JOB[JOB["PROFESSOR"] = 4017] = "PROFESSOR";
    JOB[JOB["STALKER"] = 4018] = "STALKER";
    JOB[JOB["CREATOR"] = 4019] = "CREATOR";
    JOB[JOB["CLOWN"] = 4020] = "CLOWN";
    JOB[JOB["GYPSY"] = 4021] = "GYPSY";
    JOB[JOB["PALADIN2"] = 4022] = "PALADIN2";
    JOB[JOB["BABY"] = 4023] = "BABY";
    JOB[JOB["BABY_SWORDMAN"] = 4024] = "BABY_SWORDMAN";
    JOB[JOB["BABY_MAGE"] = 4025] = "BABY_MAGE";
    JOB[JOB["BABY_ARCHER"] = 4026] = "BABY_ARCHER";
    JOB[JOB["BABY_ACOLYTE"] = 4027] = "BABY_ACOLYTE";
    JOB[JOB["BABY_MERCHANT"] = 4028] = "BABY_MERCHANT";
    JOB[JOB["BABY_THIEF"] = 4029] = "BABY_THIEF";
    JOB[JOB["BABY_KNIGHT"] = 4030] = "BABY_KNIGHT";
    JOB[JOB["BABY_PRIEST"] = 4031] = "BABY_PRIEST";
    JOB[JOB["BABY_WIZARD"] = 4032] = "BABY_WIZARD";
    JOB[JOB["BABY_BLACKSMITH"] = 4033] = "BABY_BLACKSMITH";
    JOB[JOB["BABY_HUNTER"] = 4034] = "BABY_HUNTER";
    JOB[JOB["BABY_ASSASSIN"] = 4035] = "BABY_ASSASSIN";
    JOB[JOB["BABY_KNIGHT2"] = 4036] = "BABY_KNIGHT2";
    JOB[JOB["BABY_CRUSADER"] = 4037] = "BABY_CRUSADER";
    JOB[JOB["BABY_MONK"] = 4038] = "BABY_MONK";
    JOB[JOB["BABY_SAGE"] = 4039] = "BABY_SAGE";
    JOB[JOB["BABY_ROGUE"] = 4040] = "BABY_ROGUE";
    JOB[JOB["BABY_ALCHEMIST"] = 4041] = "BABY_ALCHEMIST";
    JOB[JOB["BABY_BARD"] = 4042] = "BABY_BARD";
    JOB[JOB["BABY_DANCER"] = 4043] = "BABY_DANCER";
    JOB[JOB["BABY_CRUSADER2"] = 4044] = "BABY_CRUSADER2";
    JOB[JOB["SUPER_BABY"] = 4045] = "SUPER_BABY";
    JOB[JOB["TAEKWON"] = 4046] = "TAEKWON";
    JOB[JOB["STAR_GLADIATOR"] = 4047] = "STAR_GLADIATOR";
    JOB[JOB["STAR_GLADIATOR2"] = 4048] = "STAR_GLADIATOR2";
    JOB[JOB["SOUL_LINKER"] = 4049] = "SOUL_LINKER";
    JOB[JOB["GANGSI"] = 4050] = "GANGSI";
    JOB[JOB["DEATH_KNIGHT"] = 4051] = "DEATH_KNIGHT";
    JOB[JOB["DARK_COLLECTOR"] = 4052] = "DARK_COLLECTOR";
    JOB[JOB["RUNE_KNIGHT"] = 4054] = "RUNE_KNIGHT";
    JOB[JOB["WARLOCK"] = 4055] = "WARLOCK";
    JOB[JOB["RANGER"] = 4056] = "RANGER";
    JOB[JOB["ARCH_BISHOP"] = 4057] = "ARCH_BISHOP";
    JOB[JOB["MECHANIC"] = 4058] = "MECHANIC";
    JOB[JOB["GUILLOTINE_CROSS"] = 4059] = "GUILLOTINE_CROSS";
    JOB[JOB["RUNE_KNIGHT_T"] = 4060] = "RUNE_KNIGHT_T";
    JOB[JOB["WARLOCK_T"] = 4061] = "WARLOCK_T";
    JOB[JOB["RANGER_T"] = 4062] = "RANGER_T";
    JOB[JOB["ARCH_BISHOP_T"] = 4063] = "ARCH_BISHOP_T";
    JOB[JOB["MECHANIC_T"] = 4064] = "MECHANIC_T";
    JOB[JOB["GUILLOTINE_CROSS_T"] = 4065] = "GUILLOTINE_CROSS_T";
    JOB[JOB["ROYAL_GUARD"] = 4066] = "ROYAL_GUARD";
    JOB[JOB["SORCERER"] = 4067] = "SORCERER";
    JOB[JOB["MINSTREL"] = 4068] = "MINSTREL";
    JOB[JOB["WANDERER"] = 4069] = "WANDERER";
    JOB[JOB["SURA"] = 4070] = "SURA";
    JOB[JOB["GENETIC"] = 4071] = "GENETIC";
    JOB[JOB["SHADOW_CHASER"] = 4072] = "SHADOW_CHASER";
    JOB[JOB["ROYAL_GUARD_T"] = 4073] = "ROYAL_GUARD_T";
    JOB[JOB["SORCERER_T"] = 4074] = "SORCERER_T";
    JOB[JOB["MINSTREL_T"] = 4075] = "MINSTREL_T";
    JOB[JOB["WANDERER_T"] = 4076] = "WANDERER_T";
    JOB[JOB["SURA_T"] = 4077] = "SURA_T";
    JOB[JOB["GENETIC_T"] = 4078] = "GENETIC_T";
    JOB[JOB["SHADOW_CHASER_T"] = 4079] = "SHADOW_CHASER_T";
    JOB[JOB["RUNE_KNIGHT2"] = 4080] = "RUNE_KNIGHT2";
    JOB[JOB["RUNE_KNIGHT_T2"] = 4081] = "RUNE_KNIGHT_T2";
    JOB[JOB["ROYAL_GUARD2"] = 4082] = "ROYAL_GUARD2";
    JOB[JOB["ROYAL_GUARD_T2"] = 4083] = "ROYAL_GUARD_T2";
    JOB[JOB["RANGER2"] = 4084] = "RANGER2";
    JOB[JOB["RANGER_T2"] = 4085] = "RANGER_T2";
    JOB[JOB["MECHANIC2"] = 4086] = "MECHANIC2";
    JOB[JOB["MECHANIC_T2"] = 4087] = "MECHANIC_T2";
    JOB[JOB["BABY_RUNE"] = 4096] = "BABY_RUNE";
    JOB[JOB["BABY_WARLOCK"] = 4097] = "BABY_WARLOCK";
    JOB[JOB["BABY_RANGER"] = 4098] = "BABY_RANGER";
    JOB[JOB["BABY_BISHOP"] = 4099] = "BABY_BISHOP";
    JOB[JOB["BABY_MECHANIC"] = 4100] = "BABY_MECHANIC";
    JOB[JOB["BABY_CROSS"] = 4101] = "BABY_CROSS";
    JOB[JOB["BABY_GUARD"] = 4102] = "BABY_GUARD";
    JOB[JOB["BABY_SORCERER"] = 4103] = "BABY_SORCERER";
    JOB[JOB["BABY_MINSTREL"] = 4104] = "BABY_MINSTREL";
    JOB[JOB["BABY_WANDERER"] = 4105] = "BABY_WANDERER";
    JOB[JOB["BABY_SURA"] = 4106] = "BABY_SURA";
    JOB[JOB["BABY_GENETIC"] = 4107] = "BABY_GENETIC";
    JOB[JOB["BABY_CHASER"] = 4108] = "BABY_CHASER";
    JOB[JOB["BABY_RUNE2"] = 4109] = "BABY_RUNE2";
    JOB[JOB["BABY_GUARD2"] = 4110] = "BABY_GUARD2";
    JOB[JOB["BABY_RANGER2"] = 4111] = "BABY_RANGER2";
    JOB[JOB["BABY_MECHANIC2"] = 4112] = "BABY_MECHANIC2";
    JOB[JOB["SUPER_NOVICE_E"] = 4190] = "SUPER_NOVICE_E";
    JOB[JOB["SUPER_BABY_E"] = 4191] = "SUPER_BABY_E";
    JOB[JOB["KAGEROU"] = 4211] = "KAGEROU";
    JOB[JOB["OBORO"] = 4212] = "OBORO";
    JOB[JOB["REBELLION"] = 4215] = "REBELLION";
    JOB[JOB["SUMMONER"] = 4218] = "SUMMONER";
    JOB[JOB["MAX"] = 4219] = "MAX";
})(JOB || (JOB = {}));
;
// const JOBL_2_1 = 0x100; //256
// const JOBL_2_2 = 0x200; //512
// const JOBL_2 = 0x300;
// const JOBL_UPPER = 0x1000; //4096
// const JOBL_BABY = 0x2000; //8192
// const JOBL_THIRD = 0x4000; //16384
// enum MAPID {
// 	JOBL_2_1 = 0x100, //256
// 	JOBL_2_2 = 0x200, //512
// 	JOBL_2 = 0x300,
// 	JOBL_UPPER = 0x1000, //4096
// 	JOBL_BABY = 0x2000, //8192
// 	JOBL_THIRD = 0x4000, //16384
// 	NOVICE = 0x0,
// 	SWORDMAN,
// 	MAGE,
// 	ARCHER,
// 	ACOLYTE,
// 	MERCHANT,
// 	THIEF,
// 	SUPER_NOVICE,
// 	TAEKWON,
// 	WEDDING,
// 	GUNSLINGER,
// 	NINJA,
// 	XMAS,
// 	SUMMER,
// 	HANBOK,
// 	GANGSI,
// 	OKTOBERFEST,
// 	SUMMONER,
// 	SUMMER2,
// 	//2_1 classes
// 	KNIGHT = JOBL_2_1|0x1,
// 	WIZARD,
// 	HUNTER,
// 	PRIEST,
// 	BLACKSMITH,
// 	ASSASSIN,
// 	SUPER_NOVICE_E,
// 	STAR_GLADIATOR,
// 	REBELLION = JOBL_2_1 | 0x0A,
// 	KAGEROU_OBORO = JOBL_2_1|0xB,
// 	DEATH_KNIGHT = JOBL_2_1|0x0E,
// //2_2 classes
// 	CRUSADER = JOBL_2_2|0x1,
// 	SAGE,
// 	BARDDANCER,
// 	MONK,
// 	ALCHEMIST,
// 	ROGUE,
// 	SOUL_LINKER = JOBL_2_2|0x8,
// 	DARK_COLLECTOR = JOBL_2_2|0x0E,
// //1-1, advanced
// 	NOVICE_HIGH = JOBL_UPPER|0x0,
// 	SWORDMAN_HIGH,
// 	MAGE_HIGH,
// 	ARCHER_HIGH,
// 	ACOLYTE_HIGH,
// 	MERCHANT_HIGH,
// 	THIEF_HIGH,
// //2_1 advanced
// 	LORD_KNIGHT = JOBL_UPPER|JOBL_2_1|0x1,
// 	HIGH_WIZARD,
// 	SNIPER,
// 	HIGH_PRIEST,
// 	WHITESMITH,
// 	ASSASSIN_CROSS,
// //2_2 advanced
// 	PALADIN = JOBL_UPPER|JOBL_2_2|0x1,
// 	PROFESSOR,
// 	CLOWNGYPSY,
// 	CHAMPION,
// 	CREATOR,
// 	STALKER,
// //1-1 baby
// 	BABY = JOBL_BABY|0x0,
// 	BABY_SWORDMAN,
// 	BABY_MAGE,
// 	BABY_ARCHER,
// 	BABY_ACOLYTE,
// 	BABY_MERCHANT,
// 	BABY_THIEF,
// 	SUPER_BABY,
// 	BABY_TAEKWON,
// //2_1 baby
// 	BABY_KNIGHT = JOBL_BABY|JOBL_2_1|0x1,
// 	BABY_WIZARD,
// 	BABY_HUNTER,
// 	BABY_PRIEST,
// 	BABY_BLACKSMITH,
// 	BABY_ASSASSIN,
// 	SUPER_BABY_E,
// 	BABY_STAR_GLADIATOR,
// //2_2 baby
// 	BABY_CRUSADER = JOBL_BABY|JOBL_2_2|0x1,
// 	BABY_SAGE,
// 	BABY_BARDDANCER,
// 	BABY_MONK,
// 	BABY_ALCHEMIST,
// 	BABY_ROGUE,
// 	BABY_SOUL_LINKER,
// //3-1 classes
// 	RUNE_KNIGHT = JOBL_THIRD|JOBL_2_1|0x1,
// 	WARLOCK,
// 	RANGER,
// 	ARCH_BISHOP,
// 	MECHANIC,
// 	GUILLOTINE_CROSS,
// //3-2 classes
// 	ROYAL_GUARD = JOBL_THIRD|JOBL_2_2|0x1,
// 	SORCERER,
// 	MINSTRELWANDERER,
// 	SURA,
// 	GENETIC,
// 	SHADOW_CHASER,
// //3-1 advanced
// 	RUNE_KNIGHT_T = JOBL_THIRD|JOBL_UPPER|JOBL_2_1|0x1,
// 	WARLOCK_T,
// 	RANGER_T,
// 	ARCH_BISHOP_T,
// 	MECHANIC_T,
// 	GUILLOTINE_CROSS_T,
// //3-2 advanced
// 	ROYAL_GUARD_T = JOBL_THIRD|JOBL_UPPER|JOBL_2_2|0x1,
// 	SORCERER_T,
// 	MINSTRELWANDERER_T,
// 	SURA_T,
// 	GENETIC_T,
// 	SHADOW_CHASER_T,
// //3-1 baby
// 	BABY_RUNE = JOBL_THIRD|JOBL_BABY|JOBL_2_1|0x1,
// 	BABY_WARLOCK,
// 	BABY_RANGER,
// 	BABY_BISHOP,
// 	BABY_MECHANIC,
// 	BABY_CROSS,
// //3-2 baby
// 	BABY_GUARD = JOBL_THIRD|JOBL_BABY|JOBL_2_2|0x1,
// 	BABY_SORCERER,
// 	BABY_MINSTRELWANDERER,
// 	BABY_SURA,
// 	BABY_GENETIC,
// 	BABY_CHASER,
// };
var item_jobmask;
(function (item_jobmask) {
    item_jobmask[item_jobmask["NOVICE"] = 1] = "NOVICE";
    item_jobmask[item_jobmask["SWORDMAN"] = 2] = "SWORDMAN";
    item_jobmask[item_jobmask["MAGE"] = 4] = "MAGE";
    item_jobmask[item_jobmask["ARCHER"] = 8] = "ARCHER";
    item_jobmask[item_jobmask["ACOLYTE"] = 16] = "ACOLYTE";
    item_jobmask[item_jobmask["MERCHANT"] = 32] = "MERCHANT";
    item_jobmask[item_jobmask["THIEF"] = 64] = "THIEF";
    item_jobmask[item_jobmask["KNIGHT"] = 128] = "KNIGHT";
    item_jobmask[item_jobmask["PRIEST"] = 256] = "PRIEST";
    item_jobmask[item_jobmask["WIZARD"] = 512] = "WIZARD";
    item_jobmask[item_jobmask["BLACKSMITH"] = 1024] = "BLACKSMITH";
    item_jobmask[item_jobmask["HUNTER"] = 2048] = "HUNTER";
    item_jobmask[item_jobmask["ASSASSIN"] = 4096] = "ASSASSIN";
    // 1<<13 free
    item_jobmask[item_jobmask["CRUSADER"] = 16384] = "CRUSADER";
    item_jobmask[item_jobmask["MONK"] = 32768] = "MONK";
    item_jobmask[item_jobmask["SAGE"] = 65536] = "SAGE";
    item_jobmask[item_jobmask["ROGUE"] = 131072] = "ROGUE";
    item_jobmask[item_jobmask["ALCHEMIST"] = 262144] = "ALCHEMIST";
    item_jobmask[item_jobmask["BARD_DANCER"] = 524288] = "BARD_DANCER";
    // 1<<20 free
    item_jobmask[item_jobmask["TAEKWON"] = 2097152] = "TAEKWON";
    item_jobmask[item_jobmask["STARGLAD"] = 4194304] = "STARGLAD";
    item_jobmask[item_jobmask["SOULLINKER"] = 8388608] = "SOULLINKER";
    item_jobmask[item_jobmask["GUNSLINGER"] = 16777216] = "GUNSLINGER";
    item_jobmask[item_jobmask["NINJA"] = 33554432] = "NINJA";
    item_jobmask[item_jobmask["BONGUN"] = 67108864] = "BONGUN";
    item_jobmask[item_jobmask["DEATHKNIGHT"] = 134217728] = "DEATHKNIGHT";
    item_jobmask[item_jobmask["DARKCOLL"] = 268435456] = "DARKCOLL";
    // 1<<29 free
    item_jobmask[item_jobmask["REBELLION"] = 1073741824] = "REBELLION";
    item_jobmask[item_jobmask["SUMMONER"] = -2147483648] = "SUMMONER";
})(item_jobmask || (item_jobmask = {}));
var item_jobmask_rA;
(function (item_jobmask_rA) {
    item_jobmask_rA[item_jobmask_rA["Novice"] = 1] = "Novice";
    item_jobmask_rA[item_jobmask_rA["Swordman"] = 2] = "Swordman";
    item_jobmask_rA[item_jobmask_rA["Magician"] = 4] = "Magician";
    item_jobmask_rA[item_jobmask_rA["Archer"] = 8] = "Archer";
    item_jobmask_rA[item_jobmask_rA["Acolyte"] = 16] = "Acolyte";
    item_jobmask_rA[item_jobmask_rA["Merchant"] = 32] = "Merchant";
    item_jobmask_rA[item_jobmask_rA["Thief"] = 64] = "Thief";
    item_jobmask_rA[item_jobmask_rA["Knight"] = 128] = "Knight";
    item_jobmask_rA[item_jobmask_rA["Priest"] = 256] = "Priest";
    item_jobmask_rA[item_jobmask_rA["Wizard"] = 512] = "Wizard";
    item_jobmask_rA[item_jobmask_rA["Blacksmith"] = 1024] = "Blacksmith";
    item_jobmask_rA[item_jobmask_rA["Hunter"] = 2048] = "Hunter";
    item_jobmask_rA[item_jobmask_rA["Assassin"] = 4096] = "Assassin";
    //Unused         = 0x00002000,
    item_jobmask_rA[item_jobmask_rA["Crusader"] = 16384] = "Crusader";
    item_jobmask_rA[item_jobmask_rA["Monk"] = 32768] = "Monk";
    item_jobmask_rA[item_jobmask_rA["Sage"] = 65536] = "Sage";
    item_jobmask_rA[item_jobmask_rA["Rogue"] = 131072] = "Rogue";
    item_jobmask_rA[item_jobmask_rA["Alchemist"] = 262144] = "Alchemist";
    item_jobmask_rA[item_jobmask_rA["BardDancer"] = 524288] = "BardDancer";
    //Unused         = 0x00100000,
    item_jobmask_rA[item_jobmask_rA["Taekwon"] = 2097152] = "Taekwon";
    item_jobmask_rA[item_jobmask_rA["StarGladiator"] = 4194304] = "StarGladiator";
    item_jobmask_rA[item_jobmask_rA["SoulLinker"] = 8388608] = "SoulLinker";
    item_jobmask_rA[item_jobmask_rA["Gunslinger"] = 16777216] = "Gunslinger";
    item_jobmask_rA[item_jobmask_rA["Ninja"] = 33554432] = "Ninja";
    item_jobmask_rA[item_jobmask_rA["Gangsi"] = 67108864] = "Gangsi";
    item_jobmask_rA[item_jobmask_rA["DeathKnight"] = 134217728] = "DeathKnight";
    item_jobmask_rA[item_jobmask_rA["DarkCollector"] = 268435456] = "DarkCollector";
    item_jobmask_rA[item_jobmask_rA["KagerouOboro"] = 536870912] = "KagerouOboro";
    item_jobmask_rA[item_jobmask_rA["Rebellion"] = 1073741824] = "Rebellion";
    item_jobmask_rA[item_jobmask_rA["Summoner"] = 2147483648] = "Summoner";
})(item_jobmask_rA || (item_jobmask_rA = {}));
var weapon_type;
(function (weapon_type) {
    weapon_type[weapon_type["FIST"] = 0] = "FIST";
    weapon_type[weapon_type["DAGGER"] = 1] = "DAGGER";
    weapon_type[weapon_type["_1HSWORD"] = 2] = "_1HSWORD";
    weapon_type[weapon_type["_2HSWORD"] = 3] = "_2HSWORD";
    weapon_type[weapon_type["_1HSPEAR"] = 4] = "_1HSPEAR";
    weapon_type[weapon_type["_2HSPEAR"] = 5] = "_2HSPEAR";
    weapon_type[weapon_type["_1HAXE"] = 6] = "_1HAXE";
    weapon_type[weapon_type["_2HAXE"] = 7] = "_2HAXE";
    weapon_type[weapon_type["MACE"] = 8] = "MACE";
    weapon_type[weapon_type["_2HMACE"] = 9] = "_2HMACE";
    weapon_type[weapon_type["STAFF"] = 10] = "STAFF";
    weapon_type[weapon_type["BOW"] = 11] = "BOW";
    weapon_type[weapon_type["KNUCKLE"] = 12] = "KNUCKLE";
    weapon_type[weapon_type["MUSICAL"] = 13] = "MUSICAL";
    weapon_type[weapon_type["WHIP"] = 14] = "WHIP";
    weapon_type[weapon_type["BOOK"] = 15] = "BOOK";
    weapon_type[weapon_type["KATAR"] = 16] = "KATAR";
    weapon_type[weapon_type["REVOLVER"] = 17] = "REVOLVER";
    weapon_type[weapon_type["RIFLE"] = 18] = "RIFLE";
    weapon_type[weapon_type["GATLING"] = 19] = "GATLING";
    weapon_type[weapon_type["SHOTGUN"] = 20] = "SHOTGUN";
    weapon_type[weapon_type["GRENADE"] = 21] = "GRENADE";
    weapon_type[weapon_type["HUUMA"] = 22] = "HUUMA";
    weapon_type[weapon_type["_2HSTAFF"] = 23] = "_2HSTAFF";
    weapon_type[weapon_type["MAX_WEAPON_TYPE"] = 24] = "MAX_WEAPON_TYPE";
    // dual-wield constants
    weapon_type[weapon_type["DOUBLE_DD"] = 25] = "DOUBLE_DD";
    weapon_type[weapon_type["DOUBLE_SS"] = 26] = "DOUBLE_SS";
    weapon_type[weapon_type["DOUBLE_AA"] = 27] = "DOUBLE_AA";
    weapon_type[weapon_type["DOUBLE_DS"] = 28] = "DOUBLE_DS";
    weapon_type[weapon_type["DOUBLE_DA"] = 29] = "DOUBLE_DA";
    weapon_type[weapon_type["DOUBLE_SA"] = 30] = "DOUBLE_SA";
})(weapon_type || (weapon_type = {}));
;
var MD;
(function (MD) {
    MD[MD["CANMOVE"] = 1] = "CANMOVE";
    MD[MD["LOOTER"] = 2] = "LOOTER";
    MD[MD["AGGRESSIVE"] = 4] = "AGGRESSIVE";
    MD[MD["ASSIST"] = 8] = "ASSIST";
    MD[MD["CASTSENSOR_IDLE"] = 16] = "CASTSENSOR_IDLE";
    MD[MD["BOSS"] = 32] = "BOSS";
    MD[MD["PLANT"] = 64] = "PLANT";
    MD[MD["CANATTACK"] = 128] = "CANATTACK";
    MD[MD["DETECTOR"] = 256] = "DETECTOR";
    MD[MD["CASTSENSOR_CHASE"] = 512] = "CASTSENSOR_CHASE";
    MD[MD["CHANGECHASE"] = 1024] = "CHANGECHASE";
    MD[MD["ANGRY"] = 2048] = "ANGRY";
    MD[MD["CHANGETARGET_MELEE"] = 4096] = "CHANGETARGET_MELEE";
    MD[MD["CHANGETARGET_CHASE"] = 8192] = "CHANGETARGET_CHASE";
    MD[MD["TARGETWEAK"] = 16384] = "TARGETWEAK";
    MD[MD["PHYSICAL_IMMUNE"] = 65536] = "PHYSICAL_IMMUNE";
    MD[MD["MAGICAL_IMMUNE"] = 131072] = "MAGICAL_IMMUNE";
})(MD || (MD = {}));
var RC;
(function (RC) {
    RC[RC["FORMLESS"] = 0] = "FORMLESS";
    RC[RC["UNDEAD"] = 1] = "UNDEAD";
    RC[RC["BRUTE"] = 2] = "BRUTE";
    RC[RC["PLANT"] = 3] = "PLANT";
    RC[RC["INSECT"] = 4] = "INSECT";
    RC[RC["FISH"] = 5] = "FISH";
    RC[RC["DEMON"] = 6] = "DEMON";
    RC[RC["DEMIHUMAN"] = 7] = "DEMIHUMAN";
    RC[RC["ANGEL"] = 8] = "ANGEL";
    RC[RC["DRAGON"] = 9] = "DRAGON";
    RC[RC["BOSS"] = 10] = "BOSS";
    RC[RC["NONBOSS"] = 11] = "NONBOSS";
    RC[RC["NONDEMIHUMAN"] = 12] = "NONDEMIHUMAN";
    RC[RC["MAX"] = 13] = "MAX";
})(RC || (RC = {}));
;
var RC_rA;
(function (RC_rA) {
    RC_rA[RC_rA["FORMLESS"] = 0] = "FORMLESS";
    RC_rA[RC_rA["UNDEAD"] = 1] = "UNDEAD";
    RC_rA[RC_rA["BRUTE"] = 2] = "BRUTE";
    RC_rA[RC_rA["PLANT"] = 3] = "PLANT";
    RC_rA[RC_rA["INSECT"] = 4] = "INSECT";
    RC_rA[RC_rA["FISH"] = 5] = "FISH";
    RC_rA[RC_rA["DEMON"] = 6] = "DEMON";
    RC_rA[RC_rA["DEMIHUMAN"] = 7] = "DEMIHUMAN";
    RC_rA[RC_rA["ANGEL"] = 8] = "ANGEL";
    RC_rA[RC_rA["DRAGON"] = 9] = "DRAGON";
    RC_rA[RC_rA["PLAYER"] = 10] = "PLAYER";
    RC_rA[RC_rA["ALL"] = 11] = "ALL";
})(RC_rA || (RC_rA = {}));
var UNIT_SIZE;
(function (UNIT_SIZE) {
    UNIT_SIZE[UNIT_SIZE["SMALL"] = 0] = "SMALL";
    UNIT_SIZE[UNIT_SIZE["MEDIUM"] = 1] = "MEDIUM";
    UNIT_SIZE[UNIT_SIZE["LARGE"] = 2] = "LARGE";
})(UNIT_SIZE || (UNIT_SIZE = {}));
;
var ELE;
(function (ELE) {
    ELE[ELE["NEUTRAL"] = 0] = "NEUTRAL";
    ELE[ELE["WATER"] = 1] = "WATER";
    ELE[ELE["EARTH"] = 2] = "EARTH";
    ELE[ELE["FIRE"] = 3] = "FIRE";
    ELE[ELE["WIND"] = 4] = "WIND";
    ELE[ELE["POISON"] = 5] = "POISON";
    ELE[ELE["HOLY"] = 6] = "HOLY";
    ELE[ELE["DARK"] = 7] = "DARK";
    ELE[ELE["GHOST"] = 8] = "GHOST";
    ELE[ELE["UNDEAD"] = 9] = "UNDEAD";
    ELE[ELE["ALL"] = 10] = "ALL";
    ELE[ELE["NONNEUTRAL"] = 11] = "NONNEUTRAL";
    ELE[ELE["MAX"] = 12] = "MAX";
})(ELE || (ELE = {}));
;
var item_upper;
(function (item_upper) {
    item_upper[item_upper["normal"] = 1] = "normal";
    item_upper[item_upper["trans"] = 2] = "trans";
    item_upper[item_upper["baby"] = 4] = "baby";
    item_upper[item_upper["third"] = 8] = "third";
    item_upper[item_upper["transThird"] = 16] = "transThird";
    item_upper[item_upper["babyThird"] = 32] = "babyThird";
})(item_upper || (item_upper = {}));
;
var emotion_type;
(function (emotion_type) {
    emotion_type[emotion_type["E_GASP"] = 0] = "E_GASP";
    emotion_type[emotion_type["E_WHAT"] = 1] = "E_WHAT";
    emotion_type[emotion_type["E_HO"] = 2] = "E_HO";
    emotion_type[emotion_type["E_LV"] = 3] = "E_LV";
    emotion_type[emotion_type["E_SWT"] = 4] = "E_SWT";
    emotion_type[emotion_type["E_IC"] = 5] = "E_IC";
    emotion_type[emotion_type["E_AN"] = 6] = "E_AN";
    emotion_type[emotion_type["E_AG"] = 7] = "E_AG";
    emotion_type[emotion_type["E_CASH"] = 8] = "E_CASH";
    emotion_type[emotion_type["E_DOTS"] = 9] = "E_DOTS";
    emotion_type[emotion_type["E_SCISSORS"] = 10] = "E_SCISSORS";
    emotion_type[emotion_type["E_ROCK"] = 11] = "E_ROCK";
    emotion_type[emotion_type["E_PAPER"] = 12] = "E_PAPER";
    emotion_type[emotion_type["E_KOREA"] = 13] = "E_KOREA";
    emotion_type[emotion_type["E_LV2"] = 14] = "E_LV2";
    emotion_type[emotion_type["E_THX"] = 15] = "E_THX";
    emotion_type[emotion_type["E_WAH"] = 16] = "E_WAH";
    emotion_type[emotion_type["E_SRY"] = 17] = "E_SRY";
    emotion_type[emotion_type["E_HEH"] = 18] = "E_HEH";
    emotion_type[emotion_type["E_SWT2"] = 19] = "E_SWT2";
    emotion_type[emotion_type["E_HMM"] = 20] = "E_HMM";
    emotion_type[emotion_type["E_NO1"] = 21] = "E_NO1";
    emotion_type[emotion_type["E_NO"] = 22] = "E_NO";
    emotion_type[emotion_type["E_OMG"] = 23] = "E_OMG";
    emotion_type[emotion_type["E_OH"] = 24] = "E_OH";
    emotion_type[emotion_type["E_X"] = 25] = "E_X";
    emotion_type[emotion_type["E_HLP"] = 26] = "E_HLP";
    emotion_type[emotion_type["E_GO"] = 27] = "E_GO";
    emotion_type[emotion_type["E_SOB"] = 28] = "E_SOB";
    emotion_type[emotion_type["E_GG"] = 29] = "E_GG";
    emotion_type[emotion_type["E_KIS"] = 30] = "E_KIS";
    emotion_type[emotion_type["E_KIS2"] = 31] = "E_KIS2";
    emotion_type[emotion_type["E_PIF"] = 32] = "E_PIF";
    emotion_type[emotion_type["E_OK"] = 33] = "E_OK";
    emotion_type[emotion_type["E_MUTE"] = 34] = "E_MUTE";
    emotion_type[emotion_type["E_INDONESIA"] = 35] = "E_INDONESIA";
    emotion_type[emotion_type["E_BZZ"] = 36] = "E_BZZ";
    emotion_type[emotion_type["E_RICE"] = 37] = "E_RICE";
    emotion_type[emotion_type["E_AWSM"] = 38] = "E_AWSM";
    emotion_type[emotion_type["E_MEH"] = 39] = "E_MEH";
    emotion_type[emotion_type["E_SHY"] = 40] = "E_SHY";
    emotion_type[emotion_type["E_PAT"] = 41] = "E_PAT";
    emotion_type[emotion_type["E_MP"] = 42] = "E_MP";
    emotion_type[emotion_type["E_SLUR"] = 43] = "E_SLUR";
    emotion_type[emotion_type["E_COM"] = 44] = "E_COM";
    emotion_type[emotion_type["E_YAWN"] = 45] = "E_YAWN";
    emotion_type[emotion_type["E_GRAT"] = 46] = "E_GRAT";
    emotion_type[emotion_type["E_HP"] = 47] = "E_HP";
    emotion_type[emotion_type["E_PHILIPPINES"] = 48] = "E_PHILIPPINES";
    emotion_type[emotion_type["E_MALAYSIA"] = 49] = "E_MALAYSIA";
    emotion_type[emotion_type["E_SINGAPORE"] = 50] = "E_SINGAPORE";
    emotion_type[emotion_type["E_BRAZIL"] = 51] = "E_BRAZIL";
    emotion_type[emotion_type["E_FLASH"] = 52] = "E_FLASH";
    emotion_type[emotion_type["E_SPIN"] = 53] = "E_SPIN";
    emotion_type[emotion_type["E_SIGH"] = 54] = "E_SIGH";
    emotion_type[emotion_type["E_PROUD"] = 55] = "E_PROUD";
    emotion_type[emotion_type["E_LOUD"] = 56] = "E_LOUD";
    emotion_type[emotion_type["E_OHNOES"] = 57] = "E_OHNOES";
    emotion_type[emotion_type["E_DICE1"] = 58] = "E_DICE1";
    emotion_type[emotion_type["E_DICE2"] = 59] = "E_DICE2";
    emotion_type[emotion_type["E_DICE3"] = 60] = "E_DICE3";
    emotion_type[emotion_type["E_DICE4"] = 61] = "E_DICE4";
    emotion_type[emotion_type["E_DICE5"] = 62] = "E_DICE5";
    emotion_type[emotion_type["E_DICE6"] = 63] = "E_DICE6";
    emotion_type[emotion_type["E_INDIA"] = 64] = "E_INDIA";
    emotion_type[emotion_type["E_LOOSER"] = 65] = "E_LOOSER";
    emotion_type[emotion_type["E_RUSSIA"] = 66] = "E_RUSSIA";
    emotion_type[emotion_type["E_VIRGIN"] = 67] = "E_VIRGIN";
    emotion_type[emotion_type["E_PHONE"] = 68] = "E_PHONE";
    emotion_type[emotion_type["E_MAIL"] = 69] = "E_MAIL";
    emotion_type[emotion_type["E_CHINESE"] = 70] = "E_CHINESE";
    emotion_type[emotion_type["E_SIGNAL"] = 71] = "E_SIGNAL";
    emotion_type[emotion_type["E_SIGNAL2"] = 72] = "E_SIGNAL2";
    emotion_type[emotion_type["E_SIGNAL3"] = 73] = "E_SIGNAL3";
    emotion_type[emotion_type["E_HUM"] = 74] = "E_HUM";
    emotion_type[emotion_type["E_ABS"] = 75] = "E_ABS";
    emotion_type[emotion_type["E_OOPS"] = 76] = "E_OOPS";
    emotion_type[emotion_type["E_SPIT"] = 77] = "E_SPIT";
    emotion_type[emotion_type["E_ENE"] = 78] = "E_ENE";
    emotion_type[emotion_type["E_PANIC"] = 79] = "E_PANIC";
    emotion_type[emotion_type["E_WHISP"] = 80] = "E_WHISP";
    //
    emotion_type[emotion_type["E_MAX"] = 81] = "E_MAX";
})(emotion_type || (emotion_type = {}));
;
function getEnumMemberNameByValue(iParamVal, typeEnum) {
    for (let member in typeEnum) {
        let num = parseInt(member);
        if (num == iParamVal) {
            return typeEnum[member];
        }
    }
    return undefined;
}
function explainEnumParam(paramVal, typeEnum) {
    let iParamVal = parseInt(paramVal);
    let paramExplanation = getEnumMemberNameByValue(iParamVal, typeEnum);
    if (paramExplanation)
        paramVal += " (" + paramExplanation + ")";
    return paramVal;
}
function explainBinMaskEnumParam(paramVal, typeEnum) {
    let iParamVal = parseInt(paramVal);
    if (iParamVal == 0xFFFFFFFF)
        return paramVal;
    let paramExplanation = "";
    for (let member in typeEnum) {
        let num = parseInt(member);
        if (num & iParamVal) {
            if (paramExplanation)
                paramExplanation += " | ";
            paramExplanation += typeEnum[member];
        }
    }
    if (paramExplanation)
        paramVal += " (" + paramExplanation + ")";
    return paramVal;
}
function explainItemIdParam(paramVal, full, html) {
    let iParamVal = parseInt(paramVal);
    if (iParamVal < 1)
        return paramVal;
    let itemDbLine = itemDB.idToDbLine.get(parseInt(paramVal));
    if (itemDbLine) {
        if (!full) {
            if (itemDbParamIndex.AegisName < itemDbLine.params.length)
                paramVal += " " + itemDbLine.params[itemDbParamIndex.AegisName];
            let imageURL = itemImageURL ? itemImageURL.replace("ITEMID", iParamVal.toString()) : iParamVal.toString();
            if (html)
                paramVal = "<img src=\"" + imageURL + "\">" + paramVal;
            else
                paramVal = makeMarkdownLinkWithImage(itemDbLine, imageURL, 18, 18) + " " + paramVal;
        }
        else {
            if (html)
                paramVal += "<br><br>ItemDB<br>";
            else
                paramVal += "   \n___  \n";
            paramVal += itemDB.explainLine(itemDbLine, html);
        }
    }
    return paramVal;
}
function isFullyNumericString(str) {
    let i = parseInt(str);
    return i.toString() == str;
}
function explainSkillIdOrTechNameParam(paramVal, html) {
    let dbLine;
    let appendTechName = false;
    if (isFullyNumericString(paramVal)) {
        dbLine = skillDB.idToDbLine.get(parseInt(paramVal));
        appendTechName = true;
    }
    else {
        dbLine = skillDB.nameToDbLine.get(paramVal);
    }
    if (!dbLine)
        return paramVal;
    let skillId = dbLine.getParamByIndex(skillDB.keyIndex);
    let techName = dbLine.getParamByIndex(skillDB.nameIndex);
    if (!techName || !skillId)
        return paramVal;
    let url = skillImageURL ? skillImageURL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", techName.toLowerCase().toString()) : "";
    let ret;
    if (html)
        ret = "<img src=\"" + url + "\">" + paramVal;
    else
        ret = makeMarkdownLinkWithImage(dbLine, url, 18, 18) + " " + paramVal;
    if (appendTechName)
        ret += " (" + dbLine.getParamByIndex(skillDB.nameIndex) + ")";
    return ret;
}
function loadConstDB(filePath, hppFilePath) {
    if (!fs.existsSync(filePath))
        throw new Error("AthenaConstDB: " + filePath + " not exists");
    let fileContent = fs.readFileSync(filePath);
    let lines;
    lines = fileContent.toString().split(/\r?\n/);
    lines.forEach(l => {
        l = l.trim();
        if (l.startsWith("//"))
            return;
        let tokens = l.split("\t");
        if (tokens.length < 2)
            return;
        constDB.set(tokens[0].toLowerCase(), new AthenaConst(tokens[0], parseInt(tokens[1])));
    });
    if (hppFilePath) {
        let fileContentStr = fs.readFileSync(hppFilePath).toString();
        fileContentStr.split("\n").forEach(line => {
            let startCommentIdx = line.indexOf("//");
            if (startCommentIdx >= 0)
                line = line.substring(0, startCommentIdx);
            if (line.includes("#define"))
                return;
            let match = line.match(/export_parameter\("([^"]*)",[ ]*([^\)]*)\);/)
                || line.match(/export_(?:deprecated_)?constant\(([^\)]*)\);/)
                || line.match(/export_(?:deprecated_)?constant_npc\(JT_([^\)]*)\);/)
                || line.match(/export_(?:deprecated_)?constant2\("([^"]*)",[ ]*([^\)]*)\);/)
                || line.match(/export_deprecated_constant3\("([^"]*)",[ ]*([^,]*),[ ]*"([^\)]*)\);/);
            if (!match)
                return;
            let name;
            let val;
            if (match.length >= 4) { // export_deprecated_constant3
                name = match[1];
                val = match[2];
                // pleaseChangeTo = match[3];
            }
            else if (match.length >= 3) {
                name = match[1];
                val = match[2];
            }
            else if (match.length >= 2) {
                name = match[1];
                val = match[1];
            }
            else
                return;
            constDB.set(name.toLowerCase(), new AthenaConst(name, isFullyNumericString(val) ? parseInt(val) : undefined));
        });
    }
}
class ItemDBParamIndex {
    constructor() {
        this.n = 0;
        this.ID = this.n++;
        this.AegisName = this.n++;
        this.Name = this.n++;
        this.RusName = is_rAthena ? undefined : this.n++;
        this.Type = this.n++;
        this.Buy = this.n++;
        this.Sell = this.n++;
        this.Weight = this.n++;
        this.ATK = this.n++;
        this.MATK = is_rAthena ? undefined : this.n++;
        this.DEF = this.n++;
        this.Range = this.n++;
        this.Slots = this.n++;
        this.Job = this.n++;
        this.Upper = this.n++;
        this.Gender = this.n++;
        this.Loc = this.n++;
        this.wLV = this.n++;
        this.eLV = this.n++;
        this.Refineable = this.n++;
        this.View = this.n++;
        this.Script = this.n++;
        this.OnEquip_Script = this.n++;
        this.OnUnequip_Script = this.n++;
    }
    visibleName() {
        return (!is_rAthena && this.RusName !== undefined) ? this.RusName : this.Name;
    }
}
let itemDbParamIndex;
class AthenaItemDB extends AthenaDB {
    constructor(filePaths) {
        super(filePaths);
    }
    explainParamByLine(line, paramIdx, html) {
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        switch (paramIdx) {
            case itemDbParamIndex.ID:
                paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine, html);
                break;
            case itemDbParamIndex.Loc:
                paramVal = explainBinMaskEnumParam(paramVal, EQP);
                break;
            case itemDbParamIndex.Type:
                paramVal = explainEnumParam(paramVal, getITEnumType());
                break;
            case itemDbParamIndex.Job:
                paramVal = explainBinMaskEnumParam(paramVal, is_rAthena ? item_jobmask_rA : item_jobmask);
                break;
            case itemDbParamIndex.Weight:
                paramVal = (parseInt(paramVal) / 10).toString();
                break;
            case itemDbParamIndex.View:
                if (line.getIntParamByIndex(itemDbParamIndex.Type) == getITEnumType().WEAPON)
                    paramVal = explainEnumParam(paramVal, weapon_type);
                break;
            case itemDbParamIndex.Upper:
                paramVal = explainBinMaskEnumParam(paramVal, item_upper);
                break;
            case itemDbParamIndex.Script:
            case itemDbParamIndex.OnEquip_Script:
            case itemDbParamIndex.OnUnequip_Script:
                let formattedScript = this.formatScript(paramVal);
                if (html)
                    paramVal = "<pre>" + formattedScript.replace(/\n/g, "<br>") + "</pre>";
                else
                    paramVal = new vscode.MarkdownString().appendCodeblock(formattedScript, languageIdLowerCase).value; // languageId eAthena with capital "A" doesn't work in this case for some reason
                break;
        }
        return super.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    getParamDocumentation(paramIdx) {
        switch (paramIdx) {
            case itemDbParamIndex.Loc:
                return this.enumToParamDocumentation(EQP, 2);
            case itemDbParamIndex.Type:
                return this.enumToParamDocumentation(getITEnumType(), 0);
            case itemDbParamIndex.Job:
                return this.enumToParamDocumentation(is_rAthena ? item_jobmask_rA : item_jobmask, 1);
            case itemDbParamIndex.View:
                return "For hats: accessoryId, for weapons:  \n" + this.enumToParamDocumentation(weapon_type, 0);
            case itemDbParamIndex.Upper:
                return this.enumToParamDocumentation(item_upper, 1);
        }
        return undefined;
    }
    getSymbolLabelForLine(l) {
        let id = l.getParamByIndex(itemDbParamIndex.ID);
        let aegisName = l.getParamByIndex(itemDbParamIndex.AegisName);
        let engName = l.getParamByIndex(itemDbParamIndex.Name);
        let rusName = itemDbParamIndex.RusName ? l.getParamByIndex(itemDbParamIndex.RusName) : undefined;
        if (!id || !aegisName || !engName)
            return undefined;
        let ret = id + ":" + aegisName + ":" + engName;
        if (rusName)
            ret += ":" + rusName;
        return ret;
    }
    explainLine(line, html, cursorPosition) {
        let ret = super.explainLine(line, html, cursorPosition);
        let itemId = line.getIntParamByIndex(itemDbParamIndex.ID);
        if (itemId) {
            let itemTradeLine = itemTradeDB.idToDbLine.get(itemId);
            if (itemTradeLine) {
                let tradeRestrictions = itemTradeDB.explainParamByLine(itemTradeLine, AthenaItemTradeDBColumns.TradeMask, html);
                if (tradeRestrictions)
                    ret += (html ? "<br>" : "  \n") + tradeRestrictions;
            }
        }
        return ret;
    }
    formatScript(script) {
        if (script.startsWith("{") && script.endsWith("}"))
            script = script.substring(1, script.length - 1);
        let formattedScript = "";
        let indent = 0;
        let i = 0;
        // skip whitespace at start
        for (i = 0; i < script.length; i++)
            if (!isWhitespace(script.charAt(i)))
                break;
        for (; i < script.length; i++) {
            let c = script.charAt(i);
            if (c == "{") {
                indent++;
                formattedScript += "{\n" + "\t".repeat(indent);
                // skip whitespace
                i++;
                for (; i < script.length; i++)
                    if (!isWhitespace(script.charAt(i)))
                        break;
                i--;
            }
            else if (c == "}") {
                indent--;
                if (indent < 0)
                    indent = 0;
                if (formattedScript.charAt(formattedScript.length - 1) == "\t")
                    formattedScript = formattedScript.substr(0, formattedScript.length - 1); // crop last tab to reduce indent
                formattedScript += "}" + "\n" + "\t".repeat(indent);
                // skip whitespace
                i++;
                for (; i < script.length; i++)
                    if (!isWhitespace(script.charAt(i)))
                        break;
                i--;
            }
            else if (c == ";") {
                formattedScript += ";\n" + "\t".repeat(indent);
                // skip whitespace
                i++;
                for (; i < script.length; i++)
                    if (!isWhitespace(script.charAt(i)))
                        break;
                i--;
            }
            else if (c == "\"") {
                formattedScript += c;
                i++;
                for (; i < script.length; i++) {
                    formattedScript += script.charAt(i);
                    if (script.charAt(i) == "\"" && script.charAt(i - 1) != "\\")
                        break;
                }
            }
            else {
                formattedScript += c;
            }
        }
        formattedScript = formattedScript.trim();
        return formattedScript;
    }
}
class MobDBParamIndex {
    constructor() {
        this.n = 0;
        this.ID = this.n++;
        this.Sprite_Name = this.n++;
        this.kROName = this.n++;
        this.iROName = this.n++;
        this.RusName = is_rAthena ? undefined : this.n++;
        this.LV = this.n++;
        this.HP = this.n++;
        this.SP = this.n++;
        this.EXP = this.n++;
        this.JEXP = this.n++;
        this.Range1 = this.n++;
        this.ATK1 = this.n++;
        this.ATK2 = this.n++;
        this.DEF = this.n++;
        this.MDEF = this.n++;
        this.STR = this.n++;
        this.AGI = this.n++;
        this.VIT = this.n++;
        this.INT = this.n++;
        this.DEX = this.n++;
        this.LUK = this.n++;
        this.Range2 = this.n++;
        this.Range3 = this.n++;
        this.Scale = this.n++;
        this.Race = this.n++;
        this.Element = this.n++;
        this.Mode = this.n++;
        this.Speed = this.n++;
        this.aDelay = this.n++;
        this.aMotion = this.n++;
        this.dMotion = this.n++;
        this.MEXP = this.n++;
        this.MVP1id = this.n++;
        this.MVP1per = this.n++;
        this.MVP2id = this.n++;
        this.MVP2per = this.n++;
        this.MVP3id = this.n++;
        this.MVP3per = this.n++;
        this.Drop1id = this.n++;
        this.Drop1per = this.n++;
        this.Drop2id = this.n++;
        this.Drop2per = this.n++;
        this.Drop3id = this.n++;
        this.Drop3per = this.n++;
        this.Drop4id = this.n++;
        this.Drop4per = this.n++;
        this.Drop5id = this.n++;
        this.Drop5per = this.n++;
        this.Drop6id = this.n++;
        this.Drop6per = this.n++;
        this.Drop7id = this.n++;
        this.Drop7per = this.n++;
        this.Drop8id = this.n++;
        this.Drop8per = this.n++;
        this.Drop9id = this.n++;
        this.Drop9per = this.n++;
        this.DropCardid = this.n++;
        this.DropCardper = this.n++;
    }
    visibleName() {
        return (!is_rAthena && this.RusName !== undefined) ? this.RusName : this.kROName;
    }
}
let mobDbParamIndex;
class AthenaMobDB extends AthenaDB {
    constructor(filePaths) {
        super(filePaths, undefined, mobDbParamIndex.ID);
    }
    explainParamByLine(line, paramIdx, html) {
        //let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramIdx == mobDbParamIndex.ID) {
            let iParamVal = parseInt(paramVal);
            if (iParamVal > 0) {
                let mobDbLine = mobDB.idToDbLine.get(parseInt(paramVal));
                if (mobDbLine) {
                    if (mobDbParamIndex.Sprite_Name < mobDbLine.params.length)
                        paramVal += " (" + mobDbLine.params[mobDbParamIndex.Sprite_Name] + ")";
                    let url = mobImageURL ? mobImageURL.replace("MOBID", iParamVal.toString()) : "";
                    if (html)
                        paramVal = "<img src=\"" + url + "\">" + paramVal;
                    else
                        paramVal = makeMarkdownLinkWithImage(mobDbLine, url, 32, 32) + " " + paramVal;
                }
            }
        }
        else if (paramIdx == mobDbParamIndex.Mode)
            paramVal = explainBinMaskEnumParam(paramVal, MD);
        else if (paramIdx == mobDbParamIndex.Element) {
            let iParamVal = parseInt(paramVal);
            let eleLv = Math.floor(iParamVal / 20);
            let eleNum = iParamVal % 10;
            let paramExplanation = getEnumMemberNameByValue(eleNum, ELE);
            if (paramExplanation)
                paramVal += " (" + paramExplanation + " " + eleLv + ")";
        }
        else if (paramIdx == mobDbParamIndex.Race)
            paramVal = explainEnumParam(paramVal, is_rAthena ? RC_rA : RC);
        else if (paramIdx == mobDbParamIndex.Scale)
            paramVal = explainEnumParam(paramVal, UNIT_SIZE);
        else if (paramIdx == mobDbParamIndex.Drop1id
            || paramIdx == mobDbParamIndex.Drop2id
            || paramIdx == mobDbParamIndex.Drop3id
            || paramIdx == mobDbParamIndex.Drop4id
            || paramIdx == mobDbParamIndex.Drop5id
            || paramIdx == mobDbParamIndex.Drop6id
            || paramIdx == mobDbParamIndex.Drop7id
            || paramIdx == mobDbParamIndex.Drop8id
            || paramIdx == mobDbParamIndex.Drop9id
            || paramIdx == mobDbParamIndex.DropCardid
            || paramIdx == mobDbParamIndex.MVP1id
            || paramIdx == mobDbParamIndex.MVP2id
            || paramIdx == mobDbParamIndex.MVP3id) {
            paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine, html);
        }
        else if (paramIdx == mobDbParamIndex.Drop1per
            || paramIdx == mobDbParamIndex.Drop2per
            || paramIdx == mobDbParamIndex.Drop3per
            || paramIdx == mobDbParamIndex.Drop4per
            || paramIdx == mobDbParamIndex.Drop5per
            || paramIdx == mobDbParamIndex.Drop6per
            || paramIdx == mobDbParamIndex.Drop7per
            || paramIdx == mobDbParamIndex.Drop8per
            || paramIdx == mobDbParamIndex.Drop9per
            || paramIdx == mobDbParamIndex.DropCardper
            || paramIdx == mobDbParamIndex.MVP1per
            || paramIdx == mobDbParamIndex.MVP2per
            || paramIdx == mobDbParamIndex.MVP3per) {
            let iVal = parseInt(paramVal);
            let iValDiv = iVal / 100;
            paramVal = iValDiv + "%";
        }
        return super.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    getParamDocumentation(paramIdx) {
        //let paramName = this.paramNames[paramIdx];
        if (paramIdx == mobDbParamIndex.Mode)
            return this.enumToParamDocumentation(MD, 1);
        else if (paramIdx == mobDbParamIndex.Element)
            return "ElementLv: value / 20  \nElementType: value % 10  \nTypes:  \n" + this.enumToParamDocumentation(ELE, 0);
        else if (paramIdx == mobDbParamIndex.Race)
            return this.enumToParamDocumentation(is_rAthena ? RC_rA : RC, 0);
        else if (paramIdx == mobDbParamIndex.Scale)
            return this.enumToParamDocumentation(UNIT_SIZE, 0);
        return undefined;
    }
    getSymbolLabelForLine(l) {
        let id = l.getParamByIndex(mobDbParamIndex.ID);
        let spriteName = l.getParamByIndex(mobDbParamIndex.Sprite_Name);
        let kROName = l.getParamByIndex(mobDbParamIndex.kROName);
        if (!id || !spriteName || !kROName)
            return undefined;
        let rusName = mobDbParamIndex.RusName ? l.getParamByIndex(mobDbParamIndex.RusName) : undefined;
        let ret = id + ":" + spriteName + ":" + kROName;
        if (rusName)
            ret += ":" + rusName;
        return ret;
    }
    explainLine(line, html, cursorPosition) {
        let addExplanation = "";
        let mobIdStr = line.getParamByIndex(this.keyIndex);
        if (mobIdStr) {
            let mobId = parseInt(mobIdStr);
            if (mobId > 0 && mobSkillDB.mobidToSkillList) {
                let mobSkills = mobSkillDB.mobidToSkillList.get(mobId);
                if (mobSkills && mobSkills.length > 0) {
                    mobSkills.forEach(l => {
                        let skillId = l.getParamByIndex(mobSkillDBParamIndex.skillId);
                        if (skillId) {
                            let skillIdExplanation = explainSkillIdOrTechNameParam(skillId, html);
                            let mobSkillDbLineShort = mobSkillDB.explainLineShort(l);
                            if (html)
                                addExplanation += "<br>" + "Skill: " + skillIdExplanation + "<br>" + mobSkillDbLineShort + "<br>";
                            else
                                addExplanation += "  \n" + makeMarkdownLink("Skill", l.filePath, l.lineNum) + " : " + skillIdExplanation + "  \n" + mobSkillDbLineShort + "  \n";
                        }
                    });
                }
            }
        }
        return super.explainLine(line, html, cursorPosition) + addExplanation;
    }
}
class AthenaMobSkillDB extends AthenaDB {
    constructor(fileNames) {
        super(fileNames, undefined, 999, 999);
    }
    explainParamByLine(line, paramIdx, html) {
        //MOB_ID,dummy value (info only),STATE,SKILL_ID,SKILL_LV,rate (10000 = 100%),casttime,delay,cancelable,target,condition type,condition value,val1,val2,val3,val4,val5,emotion,chat{,increaseRange,castbegin_script,castend_script}
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "MOB_ID") {
            let iVal = parseInt(paramVal);
            if (iVal > 0) {
                let mobDbLine = mobDB.idToDbLine.get(iVal);
                if (mobDbLine)
                    paramVal += "   \n___  \n" + mobDB.explainLine(mobDbLine, html);
            }
        }
        else if (paramName == "SKILL_ID") {
            paramVal = explainSkillIdOrTechNameParam(paramVal, html);
        }
        else if (paramName == "rate (10000 = 100%)") {
            paramVal = parseInt(paramVal) / 100 + " %";
        }
        else if (paramName == "casttime" || paramName == "delay")
            paramVal = millisecondsToHumanReadableString(parseInt(paramVal));
        else if (paramName == "dummy value (info only)") {
            if (!this.alreadyExplainingLine) {
                paramVal = this.explainLine(line, html);
            }
        }
        else if (paramName == "target")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleTargets);
        else if (paramName == "STATE")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleStates);
        else if (paramName == "condition type")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleConditions);
        else if (paramName == "condition value") {
            let condTypeParamIdx = this.getParamIndex("condition type");
            if (condTypeParamIdx !== undefined) {
                let condTypeVal = line.getParamByIndex(condTypeParamIdx);
                if (condTypeVal == "skillused" || condTypeVal == "afterskill")
                    paramVal = explainSkillIdOrTechNameParam(paramVal, html);
            }
        }
        else if (paramName == "emotion")
            paramVal = explainEnumParam(paramVal, emotion_type);
        return this.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    getExplanationByArray(paramVal, array) {
        for (let i = 0; i < array.length; i++) {
            let t = array[i];
            if (paramVal == t[0] && t.length > 1) {
                paramVal += " : " + t[1];
                break;
            }
        }
        return paramVal;
    }
    getDocumentationByArray(array) {
        let ret = "";
        array.forEach(t => {
            ret += "  \n" + t[0];
            if (t.length > 1)
                ret += " : " + t[1];
        });
        return ret;
    }
    getParamDocumentation(paramIdx) {
        let paramName = this.paramNames[paramIdx];
        if (paramName == "target") {
            return this.getDocumentationByArray(AthenaMobSkillDB.possibleTargets);
        }
        else if (paramName == "STATE") {
            return this.getDocumentationByArray(AthenaMobSkillDB.possibleStates);
        }
        else if (paramName == "condition type")
            return this.getDocumentationByArray(AthenaMobSkillDB.possibleConditions);
    }
    // Need a custom index rebuild function to support multiple skills per mob
    rebuildIndex() {
        let mobIdIndex = 0;
        this.mobidToSkillList = new Map();
        this.files.forEach(f => {
            f.lines.forEach(l => {
                if (mobIdIndex >= l.params.length)
                    return;
                let mobId = parseInt(l.params[mobIdIndex]);
                if (mobId < 1 || !this.mobidToSkillList)
                    return;
                let mobSkills = this.mobidToSkillList.get(mobId);
                if (!mobSkills)
                    mobSkills = new Array();
                mobSkills.push(l);
                this.mobidToSkillList.set(mobId, mobSkills);
            });
        });
    }
    explainLineShort(dbLine) {
        let p = mobSkillDBParamIndex;
        //MOB_ID,dummy value (info only),STATE,SKILL_ID,SKILL_LV,rate (10000 = 100%),casttime,delay,cancelable,target,condition type,condition value,val1,val2,val3,val4,val5,emotion,chat{,increaseRange,castbegin_script,castend_script}
        //let skillId = dbLine.getIntParamByIndex(p.skillId);
        let skillLv = dbLine.getIntParamByIndex(p.skillLv);
        let state = dbLine.getParamByIndex(p.state);
        let rate = dbLine.getIntParamByIndex(p.rate) || 0;
        let casttime = dbLine.getIntParamByIndex(p.casttime) || 0;
        let delay = dbLine.getIntParamByIndex(p.delay) || 0;
        let target = dbLine.getParamByIndex(p.target);
        let condtype = dbLine.getParamByIndex(p.conditionType);
        let condVal = dbLine.getIntParamByIndex(p.conditionValue) || 0;
        let val1 = dbLine.getIntParamByIndex(p.val1);
        let val2 = dbLine.getIntParamByIndex(p.val2);
        let val3 = dbLine.getIntParamByIndex(p.val3);
        let val4 = dbLine.getIntParamByIndex(p.val4);
        let val5 = dbLine.getIntParamByIndex(p.val5);
        return "Lv" + skillLv + " "
            + (rate ? rate / 100.0 : 0) + "% "
            + state + " "
            + (casttime ? "ct:" + millisecondsToHumanReadableString(casttime) + " " : "")
            + (delay ? "cd:" + millisecondsToHumanReadableString(delay) + " " : "")
            + target + " "
            + condtype + " "
            + condVal + " "
            + (val1 || "") + " "
            + (val2 || "") + " "
            + (val3 || "") + " "
            + (val4 || "") + " "
            + (val5 || "");
    }
}
AthenaMobSkillDB.possibleTargets = [
    ["target"],
    ["self"],
    ["friend"],
    ["master"],
    ["randomtarget"],
    ["around1", "3x3 area around self"],
    ["around2", "5x5 area around self"],
    ["around3", "7x7 area around self"],
    ["around4", "9x9 area around self"],
    ["around5", "3x3 area around target"],
    ["around6", "5x5 area around target"],
    ["around7", "7x7 area around target"],
    ["around8", "9x9 area around target"],
    ["around", "same as around4 (9x9 around self)"],
];
AthenaMobSkillDB.possibleStates = [
    ["any", "All states except Dead"],
    ["idle"],
    ["walk"],
    ["loot"],
    ["dead", "when killed"],
    ["angry", "attack before being damaged"],
    ["attack", "attack after being damaged"],
    ["follow", "chase before being damaged"],
    ["chase", "chase after being damaged"],
    ["anytarget", "Berserk+Angry+Rush+Follow"]
];
AthenaMobSkillDB.possibleConditions = [
    ["always", "unconditional"],
    ["onspawn", "when the mob spawns/respawns."],
    ["myhplemaxrate", "when the mob's hp drops to a certain %, inclusive"],
    ["myhpinrate", "when the mob's hp is in a certain % range ('a condition value' is the lower cap, while 'a value 1' is the upper cap, inclusive)."],
    ["mystatuson", "If the mob has any abnormalities in status (condition value)"],
    ["mystatusoff", "If the mob has ended any abnormalities in status (condition value)"],
    ["friendhplemaxrate", "when the mob's friend's hp drops to a certain %, inclusive"],
    ["friendhpinrate", "when the mob's friend's hp is in a certain % range (range defined the same way as in myhpinrate)"],
    ["friendstatuson", "If the friend has any abnormalities in status (condition value)"],
    ["friendstatusoff", "If the friend has ended any abnormalities in status (condition value)"],
    ["attackpcgt", "Attack PC becomes more than the  number of specification"],
    ["attackpcge", "Attack PC becomes equal or more than the number of specification."],
    ["slavelt", "when the number of slaves is lower than the original number of specification."],
    ["slavele", "when the number of slaves is lower or equal than the original number of specification."],
    ["closedattacked", "when melee attacked (close range attack)"],
    ["longrangeattacked", "when long ranged attacked (like bows and far range weapons)"],
    ["skillused", "when a skill is used on the mob"],
    ["afterskill", "after the mob used certain skill."],
    ["casttargeted", "when a target is in cast range."],
    ["rudeattacked", "when a target is rude attacked"],
];
class MobSkillDBParamIndex {
    constructor() {
        this.n = 0;
        this.mobId = this.n++;
        this.dummyName = this.n++;
        this.state = this.n++;
        this.skillId = this.n++;
        this.skillLv = this.n++;
        this.rate = this.n++;
        this.casttime = this.n++;
        this.delay = this.n++;
        this.cancelable = this.n++;
        this.target = this.n++;
        this.conditionType = this.n++;
        this.conditionValue = this.n++;
        this.val1 = this.n++;
        this.val2 = this.n++;
        this.val3 = this.n++;
        this.val4 = this.n++;
        this.val5 = this.n++;
        this.emotion = this.n++;
        this.chat = is_rAthena ? undefined : this.n++;
        this.increaseRange = is_rAthena ? undefined : this.n++;
        this.castBeginScript = is_rAthena ? undefined : this.n++;
        this.castEndScript = is_rAthena ? undefined : this.n++;
    }
}
let mobSkillDBParamIndex;
var INF;
(function (INF) {
    INF[INF["ATTACK_SKILL"] = 1] = "ATTACK_SKILL";
    INF[INF["GROUND_SKILL"] = 2] = "GROUND_SKILL";
    INF[INF["SELF_SKILL"] = 4] = "SELF_SKILL";
    // 0x08 not assigned
    INF[INF["SUPPORT_SKILL"] = 16] = "SUPPORT_SKILL";
    INF[INF["TARGET_TRAP"] = 32] = "TARGET_TRAP";
})(INF || (INF = {}));
;
var NK;
(function (NK) {
    NK[NK["NO_DAMAGE"] = 1] = "NO_DAMAGE";
    NK[NK["SPLASH"] = 6] = "SPLASH";
    NK[NK["SPLASHSPLIT"] = 4] = "SPLASHSPLIT";
    NK[NK["NO_CARDFIX_ATK"] = 8] = "NO_CARDFIX_ATK";
    NK[NK["NO_ELEFIX"] = 16] = "NO_ELEFIX";
    NK[NK["IGNORE_DEF"] = 32] = "IGNORE_DEF";
    NK[NK["IGNORE_FLEE"] = 64] = "IGNORE_FLEE";
    NK[NK["NO_CARDFIX_DEF"] = 128] = "NO_CARDFIX_DEF";
})(NK || (NK = {}));
;
var INF2;
(function (INF2) {
    INF2[INF2["QUEST_SKILL"] = 1] = "QUEST_SKILL";
    INF2[INF2["NPC_SKILL"] = 2] = "NPC_SKILL";
    INF2[INF2["WEDDING_SKILL"] = 4] = "WEDDING_SKILL";
    INF2[INF2["SPIRIT_SKILL"] = 8] = "SPIRIT_SKILL";
    INF2[INF2["GUILD_SKILL"] = 16] = "GUILD_SKILL";
    INF2[INF2["SONG_DANCE"] = 32] = "SONG_DANCE";
    INF2[INF2["ENSEMBLE_SKILL"] = 64] = "ENSEMBLE_SKILL";
    INF2[INF2["TRAP"] = 128] = "TRAP";
    INF2[INF2["TARGET_SELF"] = 256] = "TARGET_SELF";
    INF2[INF2["NO_TARGET_SELF"] = 512] = "NO_TARGET_SELF";
    INF2[INF2["PARTY_ONLY"] = 1024] = "PARTY_ONLY";
    INF2[INF2["GUILD_ONLY"] = 2048] = "GUILD_ONLY";
    INF2[INF2["NO_ENEMY"] = 4096] = "NO_ENEMY";
    INF2[INF2["CHORUS_SKILL"] = 8192] = "CHORUS_SKILL";
    INF2[INF2["NO_NEUTRAL"] = 16384] = "NO_NEUTRAL";
    INF2[INF2["HOMUN_SKILL"] = 32768] = "HOMUN_SKILL";
    INF2[INF2["ELEMENTAL_SKILL"] = 65536] = "ELEMENTAL_SKILL";
    INF2[INF2["MERC_SKILL"] = 131072] = "MERC_SKILL";
    INF2[INF2["SHOW_SCALE"] = 262144] = "SHOW_SCALE";
})(INF2 || (INF2 = {}));
;
class SkillDBParamIndex {
    constructor() {
        this.n = 0;
        this.id = this.n++;
        this.range = this.n++;
        this.hit = this.n++;
        this.inf = this.n++;
        this.element = this.n++;
        this.nk = this.n++;
        this.splash = this.n++;
        this.max = this.n++;
        this.numberOfHits = this.n++;
        this.castCancel = this.n++;
        this.castDefenseRate = this.n++;
        this.inf2 = this.n++;
        this.maxCount = this.n++;
        this.skillType = this.n++;
        this.blowCount = this.n++;
        this.inf3 = is_rAthena ? this.n++ : undefined;
        this.techName = this.n++;
        this.visibleName = this.n++;
        this.rusName = !is_rAthena ? this.n++ : undefined;
    }
    defaultVisibleName() {
        return (!is_rAthena && this.rusName !== undefined) ? this.rusName : this.visibleName;
    }
}
let skillDbParamIndex;
class AthenaSkillDB extends AthenaDB {
    constructor(fileName) {
        super(fileName ? [fileName] : [athenaDbDir + "/skill_db.txt"], undefined, 0, skillDbParamIndex.techName);
    }
    explainParamByLine(line, paramIdx, html) {
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "name" || paramName == "id") {
            paramVal = explainSkillIdOrTechNameParam(paramVal, html);
        }
        else if (paramName == "range") {
            let iVal = parseInt(paramVal);
            if (iVal < 5)
                paramVal += " (melee)";
            else
                paramVal += " (ranged)";
        }
        else if (paramName == "hit") {
            let iVal = parseInt(paramVal);
            if (iVal == 8)
                paramVal += " (repeated hitting)";
            else if (iVal == 6)
                paramVal += " (single hit)";
        }
        else if (paramName == "inf")
            paramVal = explainBinMaskEnumParam(paramVal, INF);
        else if (paramName == "element") {
            let iVal = parseInt(paramVal);
            if (iVal == -1)
                paramVal += " (weapon)";
            else if (iVal == -2)
                paramVal += " (endowed)";
            else if (iVal == -3)
                paramVal += " (random)";
            else
                paramVal = explainEnumParam(paramVal, ELE);
        }
        else if (paramName == "nk")
            paramVal = explainBinMaskEnumParam(paramVal, NK);
        else if (paramName == "splash") {
            let iVal = parseInt(paramVal);
            if (iVal == -1)
                paramVal += " (fullscreen)";
        }
        else if (paramName == "number_of_hits") {
            let iVal = parseInt(paramVal);
            if (iVal < 0)
                paramVal = "/" + (-iVal);
            else if (iVal > 0)
                paramVal = "x" + iVal;
        }
        else if (paramName == "inf2")
            paramVal = explainBinMaskEnumParam(paramVal, INF2);
        return this.explainParamByLineSub(line, paramIdx, paramVal, html);
    }
    getParamDocumentation(paramIdx) {
        let paramName = this.paramNames[paramIdx];
        if (paramName == "inf")
            return this.enumToParamDocumentation(INF, 1);
        else if (paramName == "nk")
            return this.enumToParamDocumentation(NK, 1);
        else if (paramName == "inf2")
            return this.enumToParamDocumentation(INF2, 1);
        else if (paramName == "element")
            return this.enumToParamDocumentation(ELE, 0);
    }
    explainLine(line, html, cursorPosition) {
        let result = super.explainLine(line, html, cursorPosition);
        let skillId = parseInt(line.params[this.keyIndex]);
        if (skillId < 1)
            return result;
        let skillCastDbLine = skillCastDB.idToDbLine.get(skillId);
        if (!skillCastDbLine)
            return result;
        let skillCastDbExplanation = skillCastDB.explainLine(skillCastDbLine, html);
        if (html)
            result = "Skill DB<br>" + result + "<br>Skill Cast DB<br>" + skillCastDbExplanation;
        else
            result = result + "   \n___  \n" + skillCastDbExplanation;
        return result;
    }
    getSymbolLabelForLine(l) {
        let skillId = l.getParamByIndex(skillDbParamIndex.id);
        let techName = l.getParamByIndex(skillDbParamIndex.techName);
        let visibleName = l.getParamByIndex(skillDbParamIndex.visibleName);
        if (skillDbParamIndex)
            if (!skillId || !techName || !visibleName)
                return undefined;
        let ret = skillId + ":" + techName + ":" + visibleName;
        if (skillDbParamIndex.rusName !== undefined)
            ret += ":" + l.getParamByIndex(skillDbParamIndex.rusName);
        return ret;
    }
}
class AthenaSkillCastDB extends AthenaDB {
    constructor(fileName) {
        super(fileName ? [fileName] : [athenaDbDir + "/skill_cast_db.txt"], undefined, undefined, 8);
    }
}
class ItemBonusDB_rAthena_Entry {
    constructor(argCount, name, params, desc) {
        this.argCount = argCount;
        this.name = name;
        this.params = params;
        this.desc = desc;
    }
}
class ItemBonusDB_rAthena {
    constructor(filePath) {
        let fileContentBytes = fs.readFileSync(filePath);
        let fileContent = iconv.decode(fileContentBytes, codepage);
        let lines = fileContent.split("\n");
        this.list = new Array();
        lines.forEach(line => {
            let match = line.match(/bonus([0-9]*) ([^,;]*)[,]*([^;]*);[ \t]*([^\n]*)/);
            if (match && match.length >= 3) {
                let argCount = parseInt(match[1]);
                let name = match[2];
                let params = match[3];
                let desc = match[4];
                this.list.push(new ItemBonusDB_rAthena_Entry(argCount, name, params, desc));
            }
        });
    }
    explainBonus(word) {
        let str = "";
        this.list.forEach(b => {
            if (b.name.toLowerCase() == word.toLowerCase())
                str += "**bonus" + (b.argCount > 0 ? b.argCount : "") + " " + b.name + "," + b.params + ";  \n" + b.desc;
        });
        if (str == "")
            return undefined;
        else
            return str;
    }
}
class ItemBonusDB extends AthenaDB {
    constructor(filePaths) {
        super(filePaths, "argCount,bonusName,bonusFormat");
    }
    searchBonus(bonusName) {
        let ret = Array();
        this.files.forEach(file => {
            file.lines.forEach(line => {
                if (line.params.length >= 3 && line.params[ItemBonusDB.bonusNameCol] == bonusName)
                    ret.push(line);
            });
        });
        return ret;
    }
    explainBonus(word) {
        let itemBonusDbLines = this.searchBonus(word);
        if (itemBonusDbLines.length > 0) {
            let str = "";
            itemBonusDbLines.forEach(bonus => {
                str += "**bonus" + (parseInt(bonus.params[ItemBonusDB.argCountCol]) > 1 ? bonus.params[ItemBonusDB.argCountCol] : "") + " " + bonus.params[ItemBonusDB.bonusNameCol] + "** " + bonus.params[ItemBonusDB.bonusFormatCol] + "  \n";
            });
            return str;
            //return new vscode.Hover(str, wordRange);
        }
        return undefined;
    }
}
ItemBonusDB.argCountCol = 0;
ItemBonusDB.bonusNameCol = 1;
ItemBonusDB.bonusFormatCol = 2;
class AthenaQuestDBFile extends AthenaDBFile {
    createLine(filePath, lineNum, line) {
        return new AthenaQuestDBLine(filePath, lineNum, line);
    }
}
class AthenaQuestDB extends AthenaDB {
    createFile(db, filePath) {
        return new AthenaQuestDBFile(db, filePath);
    }
}
function millisecondsToHumanReadableString(milliseconds) {
    let timeStr = "";
    let days = Math.floor(milliseconds / (3600 * 24 * 1000));
    let hours = Math.floor(milliseconds % (3600 * 24 * 1000) / (3600 * 1000));
    let minutes = Math.floor(milliseconds % (3600 * 1000) / (60 * 1000));
    let secondsAndMillis = milliseconds % (60 * 1000);
    if (days)
        timeStr += " " + days + "d";
    if (hours) {
        // if ( timeStr.length > 0 )
        // 	timeStr += " "
        timeStr += hours + "h";
    }
    if (minutes) {
        // if ( timeStr.length > 0 )
        // 	timeStr += " "
        timeStr += minutes + "m";
    }
    if (secondsAndMillis) {
        // if ( timeStr.length > 0 )
        // 	timeStr += " "
        timeStr += (secondsAndMillis / 1000) + "s";
    }
    return timeStr;
}
class AthenaQuestDBLine extends AthenaDBLine {
    constructor(filePath, lineNum, line) {
        super(filePath, lineNum, line);
        this.MobId = new Array(3);
        this.MobCount = new Array(3);
        this.DropItemMobId = new Array(3);
        this.DropItemId = new Array(3);
        this.DropItemRate = new Array(3);
        let n = 0;
        let tokens = this.params;
        for (let i = 0; i < tokens.length; i++)
            tokens[i] = tokens[i].trim();
        this.QuestID = parseInt(tokens[n++]);
        this.Time = tokens[n++];
        for (let i = 0; i < this.MobId.length; i++) {
            this.MobId[i] = parseInt(tokens[n++]);
            this.MobCount[i] = parseInt(tokens[n++]);
        }
        if (tokens.length > 9) {
            for (let i = 0; i < this.DropItemId.length; i++) {
                this.DropItemMobId[i] = parseInt(tokens[n++]);
                this.DropItemId[i] = parseInt(tokens[n++]);
                this.DropItemRate[i] = parseInt(tokens[n++]);
            }
        }
        this.QuestLabel = tokens[n++];
    }
    getStringForTooltip() {
        let str = makeMarkdownLink(this.lineStr, serverQuestDbPath, this.lineNum) + "  \n";
        if (this.Time.indexOf(":") == -1) {
            let timeStr = "";
            let timeNum = parseInt(this.Time);
            if (timeNum) {
                let days = Math.floor(timeNum / (3600 * 24));
                let hours = Math.floor(timeNum % (3600 * 24) / 3600);
                let minutes = Math.floor(timeNum % 3600 / 60);
                let seconds = Math.floor(timeNum % 60);
                if (days)
                    timeStr += " " + days + "d";
                if (hours)
                    timeStr += " " + hours + "h";
                if (minutes)
                    timeStr += " " + minutes + "m";
                if (seconds)
                    timeStr += " " + seconds + "s";
                str += "*Cooldown:* " + timeStr + " (" + this.Time + ")  \n";
            }
        }
        for (let i = 0; i < this.MobId.length; i++) {
            if (this.MobId[i])
                str += "" + (i + 1) + ". hunt *" + mobDB.tryGetParamOfLineByKey(this.MobId[i], "Sprite_Name") + "* x " + this.MobCount[i] + "  \n";
        }
        for (let i = 0; i < this.DropItemId.length; i++) {
            if (this.DropItemId[i]) {
                let AegisName = itemDB.tryGetParamOfLineByKey(this.DropItemId[i], "AegisName");
                let MobName = mobDB.tryGetParamOfLineByKey(this.DropItemMobId[i], "Sprite_Name");
                str += "" + (i + 1) + ". item : *" + AegisName + "* "
                    + " from mob *" + MobName + "* "
                    + " rate " + (this.DropItemRate[i] / 100) + "%  \n";
            }
        }
        str += "\n\n";
        return str;
    }
}
class ClientQuest {
}
function loadquestid2display(filePath) {
    if (!fs.existsSync(filePath)) {
        vscode.window.showErrorMessage("loadquestid2display: " + filePath + ": file not exists");
        return null;
    }
    let fileContentBytes = fs.readFileSync(filePath);
    // Replace comments with spaces
    let slash = '/'.charCodeAt(0);
    let nextLine = '\n'.charCodeAt(0);
    let space = ' '.charCodeAt(0);
    for (let i = 0; i < fileContentBytes.length - 1; i++)
        if (fileContentBytes[i] == slash && fileContentBytes[i + 1] == slash)
            while (fileContentBytes[i] != nextLine && i < fileContentBytes.length)
                fileContentBytes[i++] = space;
    let fileContent = iconv.decode(fileContentBytes, codepage);
    let tokens = fileContent.split("#");
    let ret = new Map();
    let lineNum = 0;
    for (let i = 0; i < tokens.length - 5; i += 6) {
        let n = i;
        let linesInQuestId = 0;
        let linesInQuest = 0;
        for (let j = i; j < i + 6 && j < tokens.length; j++) {
            linesInQuest += tokens[j].split("\n").length - 1;
            if (j == i)
                linesInQuestId = linesInQuest;
            tokens[j] = tokens[j].trim();
        }
        let key = parseInt(tokens[n]);
        if (key < 1) {
            let str = "";
            for (let j = i; j < i + 6 && j < tokens.length; j++)
                str += tokens[j] + "\n";
            vscode.window.showErrorMessage("invalid questid near " + str);
            break;
        }
        let q = new ClientQuest();
        q.id = tokens[n++];
        q.name = tokens[n++];
        q.skillid = tokens[n++];
        q.image = tokens[n++];
        q.longdesc = tokens[n++];
        q.shortdesc = tokens[n++];
        q.lineNum = lineNum + 1 + linesInQuestId; // offset by 1 because lineNum is 0-based; offset by linesInQuestId because usually questid starts with several newlines
        ret.set(key, q);
        lineNum += linesInQuest;
    }
    return ret;
}
var e_athena_exportsyntax;
(function (e_athena_exportsyntax) {
    e_athena_exportsyntax[e_athena_exportsyntax["FUNC"] = 0] = "FUNC";
    e_athena_exportsyntax[e_athena_exportsyntax["CONST"] = 1] = "CONST";
    e_athena_exportsyntax[e_athena_exportsyntax["ITEM"] = 2] = "ITEM";
    e_athena_exportsyntax[e_athena_exportsyntax["MOB"] = 3] = "MOB";
    e_athena_exportsyntax[e_athena_exportsyntax["SKILL"] = 4] = "SKILL";
})(e_athena_exportsyntax || (e_athena_exportsyntax = {}));
;
// tslint:disable: curly
function readCompletionsArrayFromFile(filePath) {
    let fileContent = fs.readFileSync(filePath);
    let lines = fileContent.toString().split(/\r?\n/);
    let myCompletions = new Array();
    let i;
    for (i = 0; i < lines.length; i++) {
        let tokens = lines[i].split("\t");
        if (tokens.length < 2)
            continue; // Invalid file format, should be at least type and label
        const item = new vscode.CompletionItem(tokens[1]);
        let type = parseInt(tokens[0]);
        if (type == e_athena_exportsyntax.MOB) {
            continue;
        }
        else if (type == e_athena_exportsyntax.ITEM) {
            continue;
        }
        else if (type == e_athena_exportsyntax.CONST)
            item.kind = vscode.CompletionItemKind.Constant;
        else if (type == e_athena_exportsyntax.FUNC) {
            item.kind = vscode.CompletionItemKind.Function;
            let functionInfo = new AthenaFunctionInfo(lines[i]);
            scriptFunctionDB.set(functionInfo.name, functionInfo);
        }
        else if (type == e_athena_exportsyntax.SKILL) {
            continue; //item.kind = vscode.CompletionItemKind.Class;
        }
        else
            item.kind = vscode.CompletionItemKind.Value;
        if (tokens.length > 2) {
            item.detail = tokens[2];
            if (type == e_athena_exportsyntax.CONST)
                item.filterText = tokens[1] + " " + tokens[2];
        }
        if (tokens.length > 3) {
            item.insertText = new vscode.SnippetString(tokens[3]);
            item.kind = vscode.CompletionItemKind.Method;
        }
        myCompletions.push(item);
    }
    return myCompletions;
}
function getBeginningOfLinePosition(text, position) {
    while (position > 0) {
        position--;
        if (text.charAt(position) == '\r' || text.charAt(position) == '\n') {
            position++;
            return position;
        }
    }
    return position; // 0
}
function getSymbolLabel(line) {
    let tokens = line.split("\t");
    if (tokens.length < 4) {
        if (tokens.length == 3) { // special case: mapflag
            if (line.indexOf("\tmapflag\t") != -1)
                return tokens[0] + "\t" + tokens[2];
        }
        return line;
    }
    let pos = tokens[0];
    let npctype = tokens[1];
    let fullName = tokens[2];
    //let npcview = tokens[3];
    let exname = "";
    let rusname = "";
    let exnameBegin = fullName.lastIndexOf("::");
    if (exnameBegin != -1)
        exname = fullName.substr(exnameBegin + 2);
    let rusNameBegin = fullName.indexOf("|");
    if (rusNameBegin != -1) {
        if (exnameBegin != -1)
            rusname = fullName.substring(rusNameBegin + 1, exnameBegin);
        else
            rusname = fullName.substring(rusNameBegin + 1);
    }
    let name = rusname ? fullName.substring(0, rusNameBegin) : exname ? fullName.substring(0, exnameBegin) : fullName;
    if (!exname)
        exname = name;
    if (exname && (name == " " || name == "#"))
        name = "";
    if (pos == "-" || pos == "function") {
        pos = "";
    }
    else {
        let lastIndexOfComma = pos.lastIndexOf(',');
        if (lastIndexOfComma != -1)
            pos = pos.substring(0, lastIndexOfComma);
    }
    let properties = "";
    if (pos)
        properties += pos;
    if (npctype.indexOf("duplicate(") != -1) {
        if (properties)
            properties += "    ";
        properties += npctype;
    }
    if (name && name != exname) {
        if (properties)
            properties += "    ";
        properties += name;
    }
    if (rusname) {
        if (properties)
            properties += "    ";
        properties += rusname;
    }
    if (properties)
        return exname + "    (" + properties + ")";
    else
        return exname;
}
class AthenaFuncParam {
    constructor(type, name) {
        this.name = name;
        this.type = type;
    }
    getLabel() {
        return this.type + " " + this.name;
    }
}
class AthenaFunctionInfo {
    constructor(line) {
        let tokens = line.split("\t");
        this.name = tokens[1];
        let params = tokens.length > 2 ? tokens[2].split(",") : "";
        this.params = new Array(params.length);
        for (let i = 0; i < params.length; i++) {
            let delim = params[i].indexOf(' ');
            if (delim != -1)
                this.params[i] = new AthenaFuncParam(params[i].substring(0, delim).trim(), params[i].substring(delim, params[i].length).trim());
            else
                this.params[i] = new AthenaFuncParam("", params[i]);
        }
    }
    getParamsLine() {
        let ret = "";
        for (let i = 0; i < this.params.length; i++) {
            if (i != 0)
                ret += ", ";
            ret += this.params[i].getLabel();
        }
        return ret;
    }
    getLabel() {
        return this.name + "(" + this.getParamsLine() + ")";
    }
}
class AthenaDbCompletionItem extends vscode.CompletionItem {
    constructor(label, kind, db, dbLine) {
        super(label, kind);
        this.db = db;
        this.dbLine = dbLine;
    }
}
function checkWordEnds(c) {
    return wordSeparators.indexOf(c) != -1 || isWhitespace(c);
}
function findWordReferencesInFile(filePath, words) {
    let ret = new Array();
    let fileContentBytes = fs.readFileSync(filePath);
    let fileContent = fileContentBytes.toString();
    let line = 0;
    let ofs = 0;
    for (let i = 0; i < fileContent.length; i++) {
        if (fileContent.charAt(i) == '\n') {
            line++;
            ofs = 0;
            continue;
        }
        for (let j = 0; j < words.length; j++) {
            let word = words[j];
            if (fileContent.startsWith(word, i)
                && (i == 0 || checkWordEnds(fileContent.charAt(i - 1)))
                && (i + word.length == fileContent.length - 1 || checkWordEnds(fileContent.charAt(i + word.length)))) {
                ret.push(new vscode.Location(vscode.Uri.file(filePath), new vscode.Range(new vscode.Position(line, ofs), new vscode.Position(line, ofs + word.length))));
            }
        }
        ofs++;
    }
    return ret;
}
function getDirectoryFileNamesRecursive(dirPath) {
    let ret = Array();
    let dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    dirents.forEach(dirent => {
        if (dirent.isDirectory())
            ret = ret.concat(getDirectoryFileNamesRecursive(dirPath + "/" + dirent.name));
        else if (dirent.isFile())
            ret.push(dirPath + "/" + dirent.name);
    });
    return ret;
}
function getFilesForFindReferences() {
    let resultsDb = getDirectoryFileNamesRecursive(athenaDbDir);
    let resultsNpc = getDirectoryFileNamesRecursive(athenaNpcDir);
    return resultsDb.concat(resultsNpc);
}
let filesForFindReferences = Array();
function findWordReferencesInAllFiles(words) {
    if (!filesForFindReferences || filesForFindReferences.length == 0)
        filesForFindReferences = getFilesForFindReferences();
    let ret = new Array();
    filesForFindReferences.forEach(f => {
        //console.debug(f);
        ret = ret.concat(findWordReferencesInFile(f, words));
    });
    return ret;
}
function copySearchRegex() {
    let activeEditor = vscode.window.activeTextEditor; //get_active_editor();
    if (!activeEditor)
        return;
    var activeDoc = activeEditor.document; // get_active_doc(active_editor);
    if (!activeDoc)
        return;
    let selection = activeEditor.selection;
    if (!selection) {
        ; //show_single_line_error("Selection is empty");
        return;
    }
    let text = activeDoc.getText(selection);
    if (!text)
        return;
    vscode.env.clipboard.writeText(text);
}
function isDocumentAthenaDB(document) {
    // Check auto-loaded DBs
    let autoLoadedDatabases = getAutoLoadedDatabases();
    let foundInAutoLoaded = autoLoadedDatabases.find(db => {
        let dbFile = db.findFileByFilePath(document.fileName);
        return dbFile != null;
    });
    if (foundInAutoLoaded)
        return true;
    // Check cached mapping
    if (documentToAthenaDBFile.has(document))
        return true;
    // Check file format 
    if (document.fileName.endsWith("_db.txt")
        || document.fileName.endsWith("_db2.txt")
        || formatFileName(document.fileName).includes(formatFileName(athenaDbDir))) {
        let isLineDefOnNextLine = false;
        for (let i = 0; i < 20 && i < document.lineCount - 1; i++) {
            let lineText = document.lineAt(i).text;
            if ((isLineDefOnNextLine || i == 0) && lineText.startsWith("//") && lineText.includes(",")) {
                return true;
            }
            else if (lineText.toLowerCase().startsWith("// structure of database")) {
                isLineDefOnNextLine = true;
                continue;
            }
        }
    }
    return false;
}
let itemBonusTxtPath;
let questid2displaypath;
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    const tstart = new Date().getTime();
    const editorConf = vscode.workspace.getConfiguration("editor", null);
    wordSeparators = editorConf.get("wordSeparators") || "";
    let conf = vscode.workspace.getConfiguration(languageIdLowerCase);
    function getConfValOrThrow(settingName, description) {
        let ret = conf.get(settingName);
        if (!ret) {
            let err = "[" + (description || settingName) + "] setting is not set.";
            vscode.window.showErrorMessage(err);
            throw new Error(err);
        }
        return ret;
    }
    function formatDirNameFromConfig(dirName) {
        // crop leadng and traling whitespace
        dirName = dirName.trim();
        // crop leadng and traling " (Windows "copy path" function encloses path with "" by default)
        if (dirName.startsWith("\"") && dirName.endsWith("\""))
            dirName = dirName.substring(1, dirName.length - 1);
        if (dirName.endsWith("/") || dirName.endsWith("\\"))
            dirName = dirName.substring(0, dirName.length - 1);
        return dirName;
    }
    let defaultAthenaDbColumnHighlighting;
    let defaultAthenaDbColumnHints;
    let itemDbFilePaths = [];
    let mobDbFilePaths = [];
    let mobSkillDbFilePaths = [];
    let constDBFilePath = "";
    // Split relative path related config setting to array of absolute path
    function getDbFilePathsFromConfiguration(settingName, desc) {
        let val = getConfValOrThrow(settingName, desc);
        let arr = val.split(";");
        for (let i = 0; i < arr.length; i++)
            arr[i] = athenaDbDir + "/" + arr[i];
        return arr;
    }
    // Update plugin variables from config when config setting is changed or on init
    function updateSettingsFromConfiguration() {
        let conf = vscode.workspace.getConfiguration(languageIdLowerCase);
        mobImageURL = conf.get("mobImageURL");
        itemImageURL = conf.get("itemImageURL");
        skillImageURL = conf.get("skillImageURL");
        defaultAthenaDbColumnHighlighting = conf.get("defaultAthenaDbColumnHighlighting");
        defaultAthenaDbColumnHints = conf.get("defaultAthenaDbColumnHints");
        is_rAthena = conf.get("isRAthena", false);
        itemDbParamIndex = new ItemDBParamIndex();
        mobDbParamIndex = new MobDBParamIndex();
        skillDbParamIndex = new SkillDBParamIndex();
        mobSkillDBParamIndex = new MobSkillDBParamIndex();
        athenaDir = formatDirNameFromConfig(getConfValOrThrow("athenaDirectory", "Athena directory"));
        athenaNpcDir = athenaDir + "/npc";
        if (is_rAthena) {
            athenaDbDir = athenaDir + "/db/re";
            itemDbFilePaths = [athenaDbDir + "/item_db.txt"];
            mobDbFilePaths = [athenaDbDir + "/mob_db.txt"];
            mobSkillDbFilePaths = [athenaDbDir + "/mob_skill_db.txt"];
        }
        else {
            athenaDbDir = athenaDir + "/db";
            itemDbFilePaths = [athenaDbDir + "/item_db.txt", athenaDbDir + "/item_db2.txt"];
            mobDbFilePaths = [athenaDbDir + "/mob_db.txt", athenaDbDir + "/mob_db2.txt"];
            mobSkillDbFilePaths = [athenaDbDir + "/mob_skill_db.txt", athenaDbDir + "/mob_skill_db2.txt"];
        }
        constDBFilePath = athenaDir + "/db/const.txt";
        itemBonusTxtPath = getConfValOrThrow("itemBonusTxtPath", "item_bonus.txt path");
        questid2displaypath = getConfValOrThrow("clientQuestid2displayPath", "Client questid2display.txt path");
        codepage = getConfValOrThrow("encoding", "Encoding");
    }
    updateSettingsFromConfiguration();
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(languageIdLowerCase)) {
            conf = vscode.workspace.getConfiguration(languageIdLowerCase);
            updateSettingsFromConfiguration();
        }
    });
    serverQuestDbPath = athenaDbDir + "/quest_db.txt";
    questDB = new AthenaQuestDB([serverQuestDbPath]);
    let questid2display = loadquestid2display(questid2displaypath);
    let t0 = new Date().getTime();
    mobDB = new AthenaMobDB(mobDbFilePaths);
    mobSkillDB = new AthenaMobSkillDB(mobSkillDbFilePaths);
    let t = new Date().getTime();
    let mob_db_time = t - t0;
    itemDB = new AthenaItemDB(itemDbFilePaths);
    let item_db_time = new Date().getTime() - t;
    skillDB = new AthenaSkillDB();
    skillCastDB = new AthenaSkillCastDB();
    itemTradeDB = new AthenaItemTradeDB();
    loadConstDB(constDBFilePath, is_rAthena ? athenaDir + "/src/map/script_constants.hpp" : undefined);
    const itemBonusDB = is_rAthena ? new ItemBonusDB_rAthena(itemBonusTxtPath) : new ItemBonusDB([itemBonusTxtPath]);
    let completionsTxtDir = context.extensionPath + "/res";
    let completionsTxtFn = completionsTxtDir + "/completions.txt";
    if (!fs.existsSync(completionsTxtFn)) {
        if (is_rAthena)
            syncWithAthena();
        else {
            vscode.window.showErrorMessage("File missing: " + completionsTxtFn);
            return;
        }
    }
    let allCompletions = readCompletionsArrayFromFile(completionsTxtFn);
    mobDB.idToDbLine.forEach(element => {
        const mobName = element.params[mobDbParamIndex.Sprite_Name];
        const mobId = element.params[mobDbParamIndex.ID];
        const completionItem = new AthenaDbCompletionItem(mobName, vscode.CompletionItemKind.Unit, mobDB, element);
        completionItem.filterText = mobName + " " + mobId;
        completionItem.detail = mobId;
        allCompletions.push(completionItem);
    });
    itemDB.idToDbLine.forEach(element => {
        const itemName = element.params[itemDbParamIndex.AegisName];
        const itemId = element.params[itemDbParamIndex.ID];
        const completionItem = new AthenaDbCompletionItem(itemName, vscode.CompletionItemKind.Property, itemDB, element);
        completionItem.filterText = itemName + " " + itemId;
        //completionItem.documentation = new vscode.MarkdownString(itemDB.explainLine(element));
        completionItem.detail = itemId;
        allCompletions.push(completionItem);
    });
    skillDB.idToDbLine.forEach(element => {
        const skillName = element.params[skillDB.nameIndex];
        const skillId = element.params[skillDB.keyIndex];
        const completionItem = new AthenaDbCompletionItem(skillName, vscode.CompletionItemKind.Class, skillDB, element);
        completionItem.filterText = skillName + " " + skillId;
        //completionItem.documentation = new vscode.MarkdownString(itemDB.explainLine(element));
        completionItem.detail = skillId;
        allCompletions.push(completionItem);
    });
    constDB.forEach(element => {
        let completionItem = new vscode.CompletionItem(element.name, vscode.CompletionItemKind.Constant);
        allCompletions.push(completionItem);
    });
    let referenceProvider = vscode.languages.registerReferenceProvider(languageId, {
        provideReferences(document, position, context, token) {
            let wordRange = document.getWordRangeAtPosition(position, wordPattern);
            let word = document.getText(wordRange);
            let wordInt = parseInt(word);
            let result = Array();
            let itemDbLine = itemDB.nameToDbLine.get(word);
            if (!itemDbLine && wordInt > 0)
                itemDbLine = itemDB.idToDbLine.get(wordInt);
            if (itemDbLine) {
                let itemID = itemDbLine.params[itemDbParamIndex.ID];
                result = result.concat(findWordReferencesInAllFiles([itemID, word]));
            }
            let mobDbLine = mobDB.nameToDbLine.get(word);
            if (!mobDbLine && wordInt > 0)
                mobDbLine = mobDB.idToDbLine.get(wordInt);
            if (mobDbLine) {
                let mobId = mobDbLine.params[mobDbParamIndex.ID];
                result = result.concat(findWordReferencesInAllFiles([mobId, word]));
            }
            return result;
        }
    });
    let copySearchRegexCmd = vscode.commands.registerCommand("extension.CopySearchRegex", copySearchRegex);
    let gotoDefinitionProvider = vscode.languages.registerDefinitionProvider(languageId, {
        provideDefinition(document, position, token) {
            let wordRange = document.getWordRangeAtPosition(position, wordPattern);
            let word = document.getText(wordRange);
            const mobDbLine = mobDB.nameToDbLine.get(word);
            if (mobDbLine)
                return new vscode.Location(vscode.Uri.file(mobDbLine.filePath), new vscode.Position(mobDbLine.lineNum, 0));
            const itemDbLine = itemDB.nameToDbLine.get(word);
            if (itemDbLine)
                return new vscode.Location(vscode.Uri.file(itemDbLine.filePath), new vscode.Position(itemDbLine.lineNum, 0));
            //const funcAndParam = getFunctionAndParameterInfo(document, position);
            if (isWordQuestID(document, position)) {
                const wordInt = parseInt(word);
                let result = new Array();
                if (questDB) {
                    const serverQuest = questDB.idToDbLine.get(wordInt);
                    if (serverQuest)
                        result.push(new vscode.Location(vscode.Uri.file(serverQuestDbPath), new vscode.Range(new vscode.Position(serverQuest.lineNum, 0), new vscode.Position(serverQuest.lineNum + 1, 0))));
                }
                if (questid2display) {
                    const clientQuest = questid2display.get(wordInt);
                    if (clientQuest)
                        result.push(new vscode.Location(vscode.Uri.file(questid2displaypath), new vscode.Range(new vscode.Position(clientQuest.lineNum, 0), new vscode.Position(clientQuest.lineNum + 1, 0))));
                }
                if (result.length > 0)
                    return result;
            }
            return null;
        }
    });
    class GetFunctionAndParameterInfoResult {
        constructor(func, activeParameter) {
            this.func = func;
            this.activeParameter = activeParameter;
        }
    }
    function getFunctionAndParameterInfo(document, position) {
        let line = document.lineAt(position).text;
        let lineOfs = position.character;
        let p = position;
        let activeParameter = -1;
        lineOfs--;
        // ������� �� ������ ������, ���� ������ ������
        let tmpOfs = lineOfs + 1;
        let quotesNum = 0;
        let prevQuotePos = -1;
        do {
            tmpOfs--;
            if (line.charAt(tmpOfs) == '\"' && line.charAt(tmpOfs - 1) != '\\') {
                if (quotesNum == 0)
                    prevQuotePos = tmpOfs;
                quotesNum++;
            }
        } while (tmpOfs > 0);
        if (quotesNum % 2 == 1)
            lineOfs = prevQuotePos - 1;
        while (lineOfs > 0) {
            if (line.charAt(lineOfs) == ',') {
                if (activeParameter == -1)
                    activeParameter = 0;
                activeParameter++;
                lineOfs--;
                continue;
            }
            else if (line.charAt(lineOfs) == '\"') {
                let tmpOfs = lineOfs;
                let quotesNum = 0;
                let prevQuotePos = -1;
                do {
                    tmpOfs--;
                    if (line.charAt(tmpOfs) == '\"' && line.charAt(tmpOfs - 1) != '\\') {
                        if (quotesNum == 0)
                            prevQuotePos = tmpOfs;
                        quotesNum++;
                    }
                } while (tmpOfs > 0);
                if (quotesNum % 2 == 1) {
                    // ���� ������ ������
                    lineOfs = prevQuotePos - 1;
                    continue;
                }
                else {
                    lineOfs--;
                    continue;
                }
            }
            else if (line.charAt(lineOfs) == ')') {
                let braceLv = 1;
                do {
                    lineOfs--;
                    if (line.charAt(lineOfs) == '(')
                        braceLv--;
                    else if (line.charAt(lineOfs) == ')')
                        braceLv++;
                } while (braceLv > 0 && lineOfs >= 0);
                lineOfs--;
                // ����� ������� ��������� �������� ��������� ������� ����� ��������
                while (lineOfs >= 0 && isWhitespace(line.charAt(lineOfs)))
                    lineOfs--;
                let tmp = new vscode.Position(position.line, lineOfs);
                let wordRange = document.getWordRangeAtPosition(tmp, wordPattern);
                if (wordRange == null) {
                    lineOfs--;
                    continue;
                }
                let word = document.getText(wordRange);
                let functionInfo = scriptFunctionDB.get(word);
                if (functionInfo != null)
                    lineOfs = wordRange.start.character - 1;
                continue;
            }
            else if (line.charAt(lineOfs) == '(') {
                if (activeParameter == -1)
                    activeParameter = 0;
            }
            p = new vscode.Position(position.line, lineOfs);
            let wordRange = document.getWordRangeAtPosition(p, wordPattern);
            let word = document.getText(wordRange);
            let functionInfo = scriptFunctionDB.get(word);
            if (functionInfo != null)
                return new GetFunctionAndParameterInfoResult(functionInfo, activeParameter < functionInfo.params.length ? activeParameter : functionInfo.params.length - 1);
            if (activeParameter == -1)
                activeParameter = 0;
            lineOfs--;
        }
        return null;
    }
    let signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(languageId, {
        provideSignatureHelp(document, position, token, context) {
            let hover = provideHover(document, position, token);
            let fp = getFunctionAndParameterInfo(document, position);
            if (fp) {
                let functionInfo = fp.func;
                let activeParameter = fp.activeParameter;
                let ret = new vscode.SignatureHelp();
                let infos = new Array();
                let signatureLabel = functionInfo.getLabel();
                let info = new vscode.SignatureInformation(signatureLabel);
                functionInfo.params.forEach(p => {
                    let paramLabel = p.getLabel();
                    info.parameters.push(new vscode.ParameterInformation(paramLabel, new vscode.MarkdownString(hover)));
                });
                infos.push(info);
                ret.signatures = infos;
                ret.activeSignature = 0;
                if (activeParameter != -1)
                    ret.activeParameter = activeParameter;
                return ret;
            }
            // ���� �� ��� ��� ������ �� �������, ������ ��������� ������� �� �������. ��������� �� ������������� ����������� ���������
            if (isDocumentAthenaDB(document)) {
                let dbFile = ensureDocumentAthenaDbFile(document);
                let dbLine = dbFile.lines[position.line];
                let activeParam = dbLine.getParamIdxAtPosition(position);
                let ret = new vscode.SignatureHelp();
                let infos = new Array();
                let signatureLabel = "";
                dbFile.parentDb.paramNames.forEach(p => {
                    signatureLabel += "[" + p + "]\n";
                });
                let info = new vscode.SignatureInformation(signatureLabel);
                for (let i = 0; i < dbFile.parentDb.paramNames.length; i++) {
                    let p = dbFile.parentDb.paramNames[i];
                    let documentation = dbFile.parentDb.getParamDocumentation(i);
                    let str = hover || "";
                    if (documentation)
                        str += "  \n" + documentation;
                    info.parameters.push(new vscode.ParameterInformation("[" + p + "]", new vscode.MarkdownString(str)));
                }
                dbFile.parentDb.paramNames.forEach(p => {
                });
                infos.push(info);
                ret.signatures = infos;
                ret.activeSignature = 0;
                if (activeParam != undefined)
                    ret.activeParameter = activeParam;
                return ret;
            }
        }
    });
    function isWordQuestID(document, position) {
        const wordRange = document.getWordRangeAtPosition(position, wordPattern);
        const word = document.getText(wordRange);
        if (!word)
            return false;
        const funcInfo = getFunctionAndParameterInfo(document, position);
        const paramNameLowerCase = (funcInfo && funcInfo.activeParameter >= 0) ? funcInfo.func.params[funcInfo.activeParameter].name.toLowerCase() : "";
        const wordInt = parseInt(word);
        return wordInt >= 1000 && (document.fileName.includes("quest_db.txt")
            || document.fileName.includes("questid2display.txt")
            || document.lineAt(position).text.toLowerCase().indexOf("quest") != -1
            || paramNameLowerCase.includes("quest_id") || paramNameLowerCase.includes("questid"));
    }
    function provideHover(document, position, token) {
        let colHint = "";
        if (isDocumentAthenaDB(document) && position.line != 0) {
            let dbFile = ensureDocumentAthenaDbFile(document);
            let db = dbFile.parentDb;
            let parsedLine = dbFile.lines[position.line];
            let i = 0;
            for (i = 0; i < parsedLine.paramRanges.length; i++)
                if (parsedLine.paramRanges[i].contains(position)) {
                    colHint = "Column " + i;
                    if (i < db.paramNames.length)
                        colHint += "  \n" + db.explainParamByLine(parsedLine, i, false);
                    //colHint += "  \n  \n";
                    break;
                }
        }
        let wordRange = document.getWordRangeAtPosition(position, wordPattern);
        let word = document.getText(wordRange);
        let wordInt = parseInt(word);
        let functionInfo = scriptFunctionDB.get(word);
        if (functionInfo != null) {
            if (colHint.length)
                colHint += "  \n___  \n";
            return colHint + functionInfo.getLabel();
        }
        let DBs = [itemDB, mobDB, skillDB];
        let isNameExplained = false;
        for (let i = 0; i < DBs.length; i++) { // no foreach because we use return which cant be used inside foreach
            let dbLine = DBs[i].nameToDbLine.get(word);
            if (dbLine) {
                if (colHint.length)
                    colHint += "  \n___  \n";
                colHint += DBs[i].explainLine(dbLine, false);
                isNameExplained = true;
            }
        }
        let itemBonusExplanation = itemBonusDB.explainBonus(word);
        if (itemBonusExplanation) {
            if (colHint.length)
                colHint += "  \n___  \n";
            return colHint + itemBonusExplanation;
        }
        let constDbEntry = constDB.get(word.toLowerCase());
        if (constDbEntry) {
            let val = "*script constant* " + constDbEntry.name;
            if (constDbEntry.val != undefined)
                val += " = " + constDbEntry.val;
            if (colHint.length)
                colHint += "  \n___  \n";
            colHint += val;
        }
        let funcInfo = getFunctionAndParameterInfo(document, position);
        const paramNameLowerCase = (funcInfo && funcInfo.activeParameter >= 0) ? funcInfo.func.params[funcInfo.activeParameter].name.toLowerCase() : "";
        if (isWordQuestID(document, position)) {
            let strServer = "";
            let strClient = "";
            if (questDB) {
                const serverQuest = questDB.idToDbLine.get(wordInt);
                if (serverQuest)
                    strServer = serverQuest.getStringForTooltip();
            }
            if (questid2display) {
                const clientQuest = questid2display.get(wordInt);
                if (clientQuest)
                    strClient = makeMarkdownLink(clientQuest.name, questid2displaypath, clientQuest.lineNum) + "  \n" + clientQuest.longdesc + "  \n*" + clientQuest.shortdesc + "*  \n";
            }
            let str = "";
            if (strServer && strClient)
                str = "**server**  \n___  \n" + strServer + "**client**  \n" + strClient;
            else if (strServer)
                str = strServer;
            else if (strClient)
                str = strClient;
            if (str.length)
                return colHint + str;
        }
        if (wordInt && funcInfo && funcInfo.activeParameter != -1) {
            if (paramNameLowerCase == "mob_id" || paramNameLowerCase == "mobid" || paramNameLowerCase == "mob" || paramNameLowerCase == "monster" || paramNameLowerCase == "class_" || paramNameLowerCase == "class") {
                let mobDbLine = mobDB.idToDbLine.get(wordInt);
                if (mobDbLine) {
                    if (colHint.length)
                        colHint += "  \n___  \n";
                    return colHint + mobDB.explainLine(mobDbLine, false, position);
                }
            }
            else if (paramNameLowerCase == "itemid" || paramNameLowerCase == "itid" || paramNameLowerCase == "item") {
                let itemDbLine = itemDB.idToDbLine.get(wordInt);
                if (itemDbLine) {
                    if (colHint.length)
                        colHint += "  \n___  \n";
                    return colHint + itemDB.explainLine(itemDbLine, false, position);
                }
            }
        }
        // Test for NPC view
        let lineText = document.lineAt(position).text;
        let match = lineText.match(/[A-Za-z0-9@,_ ]*\t(?:script|warp|shop|cashshop|duplicate\([^)]*\))\t[^\t]*\t([^,]*)/);
        if (match && match.length == 2 && word == match[1]) {
            let npcView;
            if (constDbEntry && constDbEntry.val)
                npcView = constDbEntry.val;
            else if (isFullyNumericString(word))
                npcView = wordInt;
            if (npcView) {
                if (colHint.length)
                    colHint += "  \n___  \n";
                let url = mobImageURL ? mobImageURL.replace("MOBID", npcView.toString()) : "";
                colHint += "![image](" + url + ")";
            }
        }
        if (colHint)
            return colHint;
        return undefined;
    }
    let hoverProvider = vscode.languages.registerHoverProvider(languageId, {
        provideHover(document, position, token) {
            let str = provideHover(document, position, token);
            if (str)
                return new vscode.Hover(str, document.getWordRangeAtPosition(position, wordPattern));
            else
                return null;
        }
    });
    let completionProvider = vscode.languages.registerCompletionItemProvider("*", {
        resolveCompletionItem(item, token) {
            if (item instanceof AthenaDbCompletionItem) {
                if (!item.documentation)
                    item.documentation = new vscode.MarkdownString(item.db.explainLine(item.dbLine, false));
            }
            let itemBonusExplanation = itemBonusDB.explainBonus(item.label);
            if (itemBonusExplanation)
                item.documentation = new vscode.MarkdownString(itemBonusExplanation);
            return item;
        },
        provideCompletionItems(document, position, token, context) {
            if (document.languageId != languageId)
                return null;
            return allCompletions;
        }
    });
    let navProvider = vscode.languages.registerDocumentSymbolProvider(languageId, {
        provideDocumentSymbols(document, token) {
            if (isDocumentAthenaDB(document))
                return ensureDocumentAthenaDbFile(document).symbols;
            let symbols = new Array();
            let text = document.getText();
            let curlyCount = 0;
            let isString = false;
            let openCurlyOffset = -1; // Current symbol beginning
            let label = "";
            let bodyStart = 0, bodyEnd = 0;
            let innerSymbols = new Array();
            for (var i = 0; i < text.length; i++) {
                var c = text.charAt(i);
                // Skip strings
                if (c == '\"' && i != 0 && text.charAt(i - 1) != '\\') {
                    isString = !isString;
                    continue;
                }
                if (isString)
                    continue;
                // Skip line comments
                if (c == '/' && i < text.length - 1 && text.charAt(i + 1) == '/') {
                    while (text.charAt(i) != '\r' && text.charAt(i) != '\n' && i < text.length)
                        i++;
                    continue;
                }
                // Skip block comments
                if (c == '/' && i < text.length - 1 && text.charAt(i + 1) == '*') {
                    while (text.charAt(i) != '*' && i < text.length - 1 && text.charAt(i + 1) != '/')
                        i++;
                    continue;
                }
                var type = -1;
                var line = document.fileName;
                if (c == '{') {
                    if (curlyCount == 0)
                        openCurlyOffset = i;
                    curlyCount++;
                }
                else if (c == '}' && curlyCount > 0) {
                    curlyCount--;
                    if (curlyCount == 0 && openCurlyOffset != -1) {
                        var beginningOfLine = getBeginningOfLinePosition(text, openCurlyOffset);
                        line = text.substring(beginningOfLine, openCurlyOffset);
                        if (line.indexOf("\tscript\t") != -1) {
                            if (line.indexOf("function\tscript\t") != -1)
                                type = vscode.SymbolKind.Function;
                            else
                                type = vscode.SymbolKind.Namespace;
                            label = getSymbolLabel(line);
                            bodyStart = beginningOfLine;
                            bodyEnd = i;
                            openCurlyOffset = -1;
                        }
                    }
                }
                else if (c == '\r' || c == '\n') {
                    let matchResult;
                    let beginningOfLine = getBeginningOfLinePosition(text, i);
                    line = text.substring(beginningOfLine, i);
                    if (line.indexOf("\tduplicate(") != -1) {
                        type = vscode.SymbolKind.EnumMember;
                        label = getSymbolLabel(line);
                    }
                    else if (line.indexOf("\twarp\t") != -1) {
                        type = vscode.SymbolKind.Event;
                        label = getSymbolLabel(line);
                    }
                    else if (line.indexOf("\tmonster\t") != -1) {
                        type = vscode.SymbolKind.Object;
                        label = line;
                    }
                    else if (line.indexOf("\tmapflag\t") != -1) {
                        type = vscode.SymbolKind.TypeParameter;
                        label = line;
                    }
                    else if (line.indexOf("\tshop\t") != -1) {
                        type = vscode.SymbolKind.Interface;
                        label = getSymbolLabel(line);
                    }
                    else if (line.indexOf("\tcashshop\t") != -1) {
                        type = vscode.SymbolKind.Interface;
                        label = getSymbolLabel(line);
                    }
                    else if (matchResult = line.match(/On[^:]*:/)) {
                        type = vscode.SymbolKind.Class;
                        label = matchResult[0];
                    }
                    else if (matchResult = line.trim().match(/function\t([^\t]*)\t{/)) {
                        if (matchResult.length >= 2) {
                            type = vscode.SymbolKind.Method;
                            label = matchResult[1];
                        }
                    }
                    bodyStart = beginningOfLine;
                    bodyEnd = i;
                }
                if (type != -1) {
                    let position = new vscode.Range(document.positionAt(bodyStart), document.positionAt(bodyEnd));
                    //let symbol = new vscode.SymbolInformation(label, type, document.fileName, new vscode.Location(document.uri, position));	// this one is only needed for workspace symbols, with file and stuff
                    let symbol = new vscode.SymbolInformation(label, type, position);
                    symbols.push(symbol);
                    type = -1;
                }
            }
            return symbols;
        }
    });
    let workspaceSymbolsProvider = vscode.languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols(query, token) {
            let ret = Array();
            // let consumed = new Array<boolean>(query.length);
            query = query.toLowerCase();
            let databases = [itemDB, mobDB, skillDB];
            let allSymbols = new Array();
            try {
                databases.forEach(db => {
                    db.files.forEach(f => {
                        allSymbols = allSymbols.concat(f.symbols);
                        if (token.isCancellationRequested)
                            throw new Error();
                    });
                });
                allSymbols.forEach(s => {
                    // Commented out: Documentation says that we need to provide a relaxed string filtering, but I like the substring comparison better, and it's faster as well.
                    // Type 1: relaxed string comparison
                    // consumed.fill(false);
                    // let queryCharIdx;
                    // let consumedNum = 0;
                    // let name = s.name.toLowerCase();
                    // for ( let nameCharIdx = 0; nameCharIdx < name.length; nameCharIdx++ ) {
                    // 	for ( queryCharIdx = 0; queryCharIdx < query.length; queryCharIdx++ ) {
                    // 		if ( query.charAt(queryCharIdx) == name.charAt(nameCharIdx) && !consumed[queryCharIdx] ) {
                    // 			consumed[queryCharIdx] = true;
                    // 			consumedNum++;
                    // 			break;
                    // 		}
                    // 	}
                    // 	if ( consumedNum == query.length )
                    // 		break; // All query chars have been consumed, no need to continue checking.
                    // }
                    // if ( consumed.includes(false) )
                    // 	return;
                    // Type 2: substring comparison
                    if (!s.name.toLowerCase().includes(query))
                        return;
                    ret.push(s);
                    if (token.isCancellationRequested)
                        throw new Error();
                });
            }
            catch (Error) { // Cancelled
                return new Array();
            }
            return ret;
        }
    });
    context.subscriptions.push(completionProvider, navProvider, hoverProvider, gotoDefinitionProvider, referenceProvider, copySearchRegexCmd, signatureHelpProvider, workspaceSymbolsProvider);
    let timeout = undefined;
    const columnColors = [
        '#AA000011',
        '#00AA0011',
        '#0000AA11',
        '#00AAAA11',
        '#AA00AA11',
        '#AAAA0011'
    ];
    let needUpdateAthenaDB = false;
    function updateDecorations(forceUpdateDecorationTypes) {
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor)
            return;
        let document = activeEditor.document;
        if (document.languageId != languageId)
            return;
        let isAthenaDB = isDocumentAthenaDB(document);
        if (!isAthenaDB)
            return;
        let enableHighlight = forceDbColumnHighlight.get(document.fileName);
        if (enableHighlight == null)
            enableHighlight = isAthenaDB && defaultAthenaDbColumnHighlighting;
        let enableHints = forceDbColumnHints.get(document.fileName);
        if (enableHints == null)
            enableHints = isAthenaDB && defaultAthenaDbColumnHints;
        let colDecorationTypes = documentToDecorationTypes.get(document);
        if (forceUpdateDecorationTypes && colDecorationTypes != null) {
            for (let i = 0; i < colDecorationTypes.length; i++)
                activeEditor.setDecorations(colDecorationTypes[i], new Array(0));
            documentToDecorationTypes.delete(document);
            colDecorationTypes = undefined;
        }
        let dbFile = needUpdateAthenaDB ? initDocumentAthenaDbFile(document) : ensureDocumentAthenaDbFile(document);
        let db = dbFile.parentDb;
        needUpdateAthenaDB = false;
        if (db.paramNames.length < 2)
            return;
        if (!colDecorationTypes) {
            colDecorationTypes = new Array(0);
            for (let i = 0; i < db.paramNames.length; i++)
                colDecorationTypes.push(vscode.window.createTextEditorDecorationType({
                    backgroundColor: enableHighlight ? columnColors[i % columnColors.length] : undefined,
                    before: enableHints ? { contentText: db.paramNames[i] + ":", color: "#88888888" } : undefined,
                    rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
                }));
            documentToDecorationTypes.set(document, colDecorationTypes);
        }
        if (!enableHighlight && !enableHints) {
            for (let i = 0; i < colDecorationTypes.length; i++)
                activeEditor.setDecorations(colDecorationTypes[i], new Array(0));
            return;
        }
        let decorations = new Array(colDecorationTypes.length);
        for (let i = 0; i < decorations.length; i++)
            decorations[i] = new Array();
        for (let i = 0; i < dbFile.lines.length; i++) {
            const athenaDbLine = dbFile.lines[i];
            for (let j = 0; j < athenaDbLine.params.length; j++) {
                let range = athenaDbLine.paramRanges[j];
                if (!enableHints) // Do not highlight trailing comma if hints enabled (otherwise it will apply decoration to the hint as well)
                    range = new vscode.Range(range.start, range.end.translate(0, 1));
                const decoration = { range: range };
                decorations[j % colDecorationTypes.length].push(decoration);
            }
        }
        for (let i = 0; i < colDecorationTypes.length; i++)
            activeEditor.setDecorations(colDecorationTypes[i], decorations[i]);
    }
    function triggerUpdateDecorations() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        timeout = setTimeout(updateDecorations, 1500);
    }
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        //needUpdateAthenaDB = true;
        //console.log("first update on file's Athena DB");
        triggerUpdateDecorations();
    }
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);
    function countOccurences(haystack, needle) {
        let index = 0;
        let count = 0;
        while (true) {
            index = haystack.indexOf(needle, index);
            if (index == -1)
                return count;
            else {
                index += needle.length;
                count++;
            }
        }
    }
    vscode.window.onDidChangeTextEditorSelection(event => {
        let selection = event.selections[0];
        if (isDocumentAthenaDB(event.textEditor.document) && webviewPanel) {
            let requireUpdateWebview = selection.start.line != webviewPanelLineNum;
            if (!requireUpdateWebview) {
                let dbFile = ensureDocumentAthenaDbFile(event.textEditor.document);
                let newActiveParam = dbFile.getParamIdxAtPosition(selection.start);
                if (newActiveParam != webviewPanelActiveParam)
                    requireUpdateWebview = true;
            }
            if (requireUpdateWebview)
                updateWebviewContent();
        }
    });
    vscode.workspace.onDidChangeTextDocument(event => {
        let document = event.document;
        let dbFile = isDocumentAthenaDB(document) ? ensureDocumentAthenaDbFile(document) : null;
        if (dbFile) {
            for (let i = 0; i < event.contentChanges.length; i++) {
                let change = event.contentChanges[i];
                for (let l = change.range.start.line; l <= change.range.end.line; l++) {
                    dbFile.updateLine(document, l);
                    if (activeEditor && activeEditor.selection.start.line == change.range.start.line && webviewPanel)
                        updateWebviewContent();
                }
            }
        }
        if (activeEditor && event.document === activeEditor.document) {
            // Update decorations only if added / removed column / row (i.e. commas count / line breaks count in prev. text and new text don't match)
            for (let i = 0; i < event.contentChanges.length; i++) {
                let change = event.contentChanges[i];
                let prevText = event.document.getText(change.range);
                let numColumnsChanged = countOccurences(prevText, ',') != countOccurences(change.text, ',');
                let numRowsChanged = countOccurences(prevText, '\n') != countOccurences(change.text, '\n');
                if (numColumnsChanged || numRowsChanged) {
                    if (numRowsChanged)
                        needUpdateAthenaDB = true;
                    triggerUpdateDecorations();
                }
            }
            ;
        }
    }, null, context.subscriptions);
    vscode.commands.registerCommand("extension.toggleAthenaDbColumnHighlighting", () => {
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor)
            return;
        let currentSetting = forceDbColumnHighlight.get(activeEditor.document.fileName);
        if (currentSetting == null)
            currentSetting = isDocumentAthenaDB(activeEditor.document) && defaultAthenaDbColumnHighlighting;
        currentSetting = !currentSetting;
        forceDbColumnHighlight.set(activeEditor.document.fileName, currentSetting);
        updateDecorations(true);
    });
    vscode.commands.registerCommand("extension.toggleAthenaDbColumnHints", () => {
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor)
            return;
        let currentSetting = forceDbColumnHints.get(activeEditor.document.fileName);
        if (currentSetting == null)
            currentSetting = isDocumentAthenaDB(activeEditor.document) && defaultAthenaDbColumnHints;
        currentSetting = !currentSetting;
        forceDbColumnHints.set(activeEditor.document.fileName, currentSetting);
        updateDecorations(true);
    });
    vscode.commands.registerCommand("extension.sortLuaKeyValTableInSelection", () => {
        sortLuaKeyValTableInSelection();
    });
    vscode.commands.registerCommand("extension.toggleLinePreview", () => {
        if (!webviewPanel) {
            webviewPanel = vscode.window.createWebviewPanel("eapreview", "DB Entry Preview", vscode.ViewColumn.Two, {
                enableScripts: true
            });
            updateWebviewContent();
            webviewPanel.onDidDispose(() => {
                webviewPanel = undefined;
            }, null, context.subscriptions);
            webviewPanel.webview.onDidReceiveMessage(message => {
                switch (message.command) {
                    case 'selectParameter':
                        if (!isDocumentAthenaDB(webviewPanelEditor.document) || webviewPanelLineNum == undefined)
                            return;
                        let dbFile = ensureDocumentAthenaDbFile(webviewPanelEditor.document);
                        if (webviewPanelLineNum >= dbFile.lines.length) {
                            vscode.window.showErrorMessage("invalid line selected");
                            return;
                        }
                        let dbLine = dbFile.lines[webviewPanelLineNum];
                        let paramIndex = dbFile.parentDb.getParamIndex(message.text);
                        if (paramIndex < 0 || paramIndex >= dbLine.paramRanges.length)
                            return;
                        let selection = new vscode.Selection(dbLine.paramRanges[paramIndex].start, dbLine.paramRanges[paramIndex].start);
                        //vscode.workspace.openTextDocument(webviewPanelEditor.document.fileName);
                        vscode.window.showTextDocument(webviewPanelEditor.document, { viewColumn: vscode.ViewColumn.One, selection: selection });
                }
            }, undefined, context.subscriptions);
        }
        else {
            webviewPanel.dispose();
            webviewPanel = undefined;
        }
    });
    vscode.commands.registerCommand("extension.copyEmbedHtml", () => {
        var _a;
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor)
            return;
        let wordRange = activeEditor.document.getWordRangeAtPosition(activeEditor.selection.start, wordPattern);
        let word = activeEditor.document.getText(wordRange);
        let itemDBLine = itemDB.nameToDbLine.get(word);
        let mobDBLine = mobDB.nameToDbLine.get(word);
        let skillDBLine = skillDB.nameToDbLine.get(word);
        let dbLine = itemDBLine || mobDBLine || skillDBLine;
        if (!dbLine) {
            vscode.window.showErrorMessage("Failed to find item/mob/skill: '" + word + "'.");
            return;
        }
        if (itemDBLine) {
            let itemId = itemDBLine.getIntParamByIndex(itemDbParamIndex.ID);
            let itemType = itemDBLine.getIntParamByIndex(itemDbParamIndex.Type);
            //let itemSection : string;
            let URL;
            if (!itemId)
                return;
            if (itemType == IT.WEAPON || itemType == IT.ARMOR || itemType == IT.AMMO)
                URL = getConfValOrThrow("databaseURL.equipItem");
            else if (itemType == IT.CARD)
                URL = getConfValOrThrow("databaseURL.cardItem");
            else
                URL = getConfValOrThrow("databaseURL.normalItem");
            URL = URL.replace("ITEMID", itemId.toString());
            if (!itemImageURL) {
                vscode.window.showErrorMessage("Item image URL setting is not set");
                return;
            }
            let imageURL = itemImageURL.replace("ITEMID", itemId.toString());
            let itemVisibleName = itemDBLine.getParamByIndex(itemDbParamIndex.visibleName());
            vscode.env.clipboard.writeText("<a href=\"" + URL + "\"><img src=\"" + imageURL + "\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">" + itemVisibleName + "</a>");
            vscode.window.showInformationMessage("HTML code to embed '" + itemVisibleName + "' has been copied to the clipboard.");
        }
        else if (mobDBLine) {
            let mobId = mobDBLine.getIntParamByIndex(mobDbParamIndex.ID);
            if (!mobId)
                return;
            let URL = getConfValOrThrow("databaseURL.mob");
            URL = URL.replace("MOBID", mobId.toString());
            if (!mobImageURL) {
                vscode.window.showErrorMessage("Mob image URL setting is not set");
                return;
            }
            let imageURL = mobImageURL.replace("MOBID", mobId.toString());
            let mobVisibleName = mobDBLine.getParamByIndex(mobDbParamIndex.visibleName());
            vscode.env.clipboard.writeText("<a href=\"" + URL + "\"><img src=\"" + imageURL + "\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">" + mobVisibleName + "</a>");
            vscode.window.showInformationMessage("HTML code to embed '" + mobVisibleName + "' has been copied to the clipboard.");
        }
        else if (skillDBLine) {
            let skillId = skillDBLine.getIntParamByIndex(skillDbParamIndex.id);
            let skillTechNameLower = (_a = skillDBLine.getParamByIndex(skillDbParamIndex.techName)) === null || _a === void 0 ? void 0 : _a.toLowerCase();
            let skillVisibleName = skillDBLine.getParamByIndex(skillDbParamIndex.defaultVisibleName());
            if (!skillId || !skillTechNameLower) // skill_id=0 is valid
                return;
            let URL = getConfValOrThrow("databaseURL.skill");
            URL = URL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", skillTechNameLower);
            if (!skillImageURL) {
                vscode.window.showErrorMessage("Skill image URL setting is not set");
                return;
            }
            let imageURL = skillImageURL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", skillTechNameLower);
            vscode.env.clipboard.writeText("<a href=\"" + URL + "\"><img src=\"" + imageURL + "\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">" + skillVisibleName + "</a>");
            vscode.window.showInformationMessage("HTML code to embed '" + skillVisibleName + "' has been copied to the clipboard.");
        }
    });
    vscode.commands.registerCommand("extension.findItemDesc", () => {
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor)
            return;
        let wordRange = activeEditor.document.getWordRangeAtPosition(activeEditor.selection.start, wordPattern);
        let word = activeEditor.document.getText(wordRange);
        //let skillDBLine = skillDB.nameToDbLine.get(word);
        let itemId;
        if (isFullyNumericString(word))
            itemId = parseInt(word);
        else {
            let itemDBLine = itemDB.nameToDbLine.get(word);
            if (!itemDBLine) {
                vscode.window.showErrorMessage("item" + word + " not found in db");
                return;
            }
            itemId = itemDBLine.getIntParamByIndex(itemDbParamIndex.ID);
            if (!itemId) {
                vscode.window.showErrorMessage("item" + word + " has no ID");
                return;
            }
        }
        let itemInfoFileName = getConfValOrThrow("itemInfoPath", "iteminfo path");
        if (!fs.existsSync(itemInfoFileName) || !fs.statSync(itemInfoFileName).isFile()) {
            vscode.window.showErrorMessage(itemInfoFileName + " not found or is not a file");
            return;
        }
        let fileContent = fs.readFileSync(itemInfoFileName);
        //let fileContentStr = iconv.decode(fileContent, codepage);
        let ofs = fileContent.indexOf("[" + itemId + "]");
        if (ofs == -1) {
            vscode.window.showErrorMessage("item with ID=" + itemId + " not found in file " + itemInfoFileName);
            return;
        }
        let ret = vscode.workspace.openTextDocument(itemInfoFileName);
        ret.then(onItemInfoOpenSuccess, onItemInfoOpenFailed);
        function onItemInfoOpenSuccess(document) {
            let pos = document.positionAt(ofs);
            vscode.window.showTextDocument(document, { selection: new vscode.Selection(pos, pos) });
        }
        function onItemInfoOpenFailed(reason) {
            vscode.window.showErrorMessage("Failed to open itemInfo file " + itemInfoFileName + " in VSCODE");
        }
    });
    function updateWebviewContent() {
        if (!webviewPanel)
            return;
        let editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        let document = editor.document;
        let selection = editor.selection;
        if (!selection || !document)
            return;
        if (!isDocumentAthenaDB(document))
            return;
        let dbFile = ensureDocumentAthenaDbFile(document);
        let dbLine = selection.start.line <= dbFile.lines.length ? dbFile.lines[selection.start.line] : null;
        if (!dbLine)
            return;
        webviewPanelEditor = editor;
        webviewPanelLineNum = editor.selection.start.line;
        webviewPanelActiveParam = dbLine.getParamIdxAtPosition(editor.selection.start);
        webviewPanel.webview.html = dbFile.parentDb.explainLine(dbLine, true, selection.start);
    }
    function syncWithAthena() {
        function replaceBetween(src, after, before, replacement) {
            let startIndex = src.indexOf(after);
            if (startIndex < 0)
                throw new Error("Failed to find start index: " + after);
            startIndex += after.length;
            let endIndex = src.indexOf(before, startIndex);
            if (endIndex < 0)
                throw new Error("Failed to find end index: " + before);
            return src.substring(0, startIndex) + replacement + src.substring(endIndex);
        }
        function escRegex(src) {
            let dst = "";
            for (let i = 0; i < src.length; i++) {
                if (src[i] == '.' || src[i] == '*' || src[i] == '[' || src[i] == ']' || src[i] == '(' || src[i] == ')' || src[i] == '?') {
                    dst += '\\';
                    dst += '\\';
                }
                dst += src[i];
            }
            return dst;
        }
        // Write completions.txt static constants
        let completionsTxt = "";
        let staticDefinitions = [
            ["script"],
            ["warp"],
            is_rAthena ? ["warp2"] : undefined,
            ["shop"],
            ["cashshop"],
            ["OnPCDieEvent", "Executed when PC becomes dead."],
            ["OnPCKillEvent", "Executed when PC kills another PC. Some skills may not invoke this."],
            ["OnNPCKillEvent"],
            ["OnPCLoginEvent", "Executed when PC logs in"],
            ["OnPCLogoutEvent", "Executed when PC logs out"],
            ["OnPCLoadMapEvent", "Executed when PC loads specified map (only if map 'loadevent' mapflag is specified)"],
            ["OnPCLoadNPCMapEvent", "Executed when PC loads NPC map"],
            ["OnPCBaseLvUpEvent", "Executed on base level up"],
            ["OnPCJobLvUpEvent", "Executed on Job level up"],
            !is_rAthena ? ["OnUpdateMarker", "Executed when PC ends talking with NPC or when PC loads NPC map"] : undefined,
            ["OnTouch_", "Executed when PC touches NPC area"],
            ["OnTouch", "Executed when PC touches NPC area but only if NPC is not busy with another PC"],
            ["OnTouchNPC", "When mob comes into OnTouch area"],
            ["OnInit", "When script loads/reloads"],
            ["OnInstanceInit", "When instance is created" + !is_rAthena ? "(need IIF_INITINSTANCENPC)" : ""],
        ];
        staticDefinitions.forEach(def => {
            if (!def)
                return;
            completionsTxt += "1\t" + def[0] + "\t" + def[1] + "\n";
        });
        // Write completions.txt functions
        let scriptCppPath = athenaDir + "/src/map/script.cpp";
        let fileContentStr = fs.readFileSync(scriptCppPath).toString();
        let startScriptFunctionDefIndex = fileContentStr.indexOf("struct script_function buildin_func[] = {");
        let funcNames = "";
        if (startScriptFunctionDefIndex != -1) {
            fileContentStr = fileContentStr.substr(startScriptFunctionDefIndex);
            fileContentStr.split("\n").forEach(line => {
                let startCommentIdx = line.indexOf("//");
                if (startCommentIdx >= 0)
                    line = line.substring(0, startCommentIdx);
                let name;
                let args;
                let match;
                match = line.match(/BUILDIN_DEF\(([^,]*),[ ]*"([^"]*)"\),/) || line.match(/BUILDIN_DEF2\([^,]*,[ ]*"([^"]*)",[ ]*"([^"]*)"\),/);
                if (!match || match.length < 3)
                    return;
                name = match[1];
                args = match[2];
                if (funcNames.length > 0)
                    funcNames += "|";
                funcNames += escRegex(name);
                completionsTxt += "0\t" + name;
                if (args.length > 0) {
                    let completionsArgs = "";
                    let completionsInsertText = name + "(";
                    for (let i = 0; i < args.length; i++) {
                        let argType = args.charAt(i);
                        if (i != 0) {
                            completionsArgs += ", ";
                            completionsInsertText += ", ";
                        }
                        completionsArgs += argType + " arg" + (i + 1);
                        completionsInsertText += "${" + (i + 1) + ":" + argType + "_arg" + (i + 1) + "}";
                    }
                    completionsInsertText += ")$0";
                    completionsTxt += "\t" + completionsArgs + "\t" + completionsInsertText;
                }
                completionsTxt += "\n";
            });
        }
        if (!fs.existsSync(completionsTxtDir))
            fs.mkdirSync(completionsTxtDir);
        fs.writeFileSync(completionsTxtFn, completionsTxt);
        // Write constant names to syntax file, for syntax highlighting
        let constNames = "";
        function fillConstNamesFromMap(map) {
            map.forEach((val, key) => {
                let nameEsc = escRegex(key);
                if (constNames.length > 0)
                    constNames += "|";
                constNames += nameEsc;
            });
            return constNames;
        }
        fillConstNamesFromMap(itemDB.nameToDbLine);
        fillConstNamesFromMap(mobDB.nameToDbLine);
        fillConstNamesFromMap(skillDB.nameToDbLine);
        constDB.forEach(val => {
            let nameEsc = escRegex(val.name);
            if (constNames.length > 0)
                constNames += "|";
            constNames += nameEsc;
        });
        let syntaxFn = context.extensionPath + "/syntaxes/eathena.json";
        let fileContent = fs.readFileSync(syntaxFn);
        fileContentStr = fileContent.toString();
        fileContentStr = replaceBetween(fileContentStr, "\"letter\": {", ")\\\\b\",", "\n      \"match\": \"\\\\b(" + constNames);
        fileContentStr = replaceBetween(fileContentStr, "\"functions\": {", ")\\\\b\",", "\n      \"match\": \"(?i)\\\\b(" + funcNames);
        fs.writeFileSync(syntaxFn, fileContentStr);
        vscode.window.showInformationMessage("VSCode eAthena plugin has been re-synchronized, reload window for the changes to take effect.");
    }
    vscode.commands.registerCommand("extension.syncWithAthena", () => {
        syncWithAthena();
    });
    let activation_time = new Date().getTime() - tstart;
    getAutoLoadedDatabases().forEach(db => {
        console.log(db.constructor.name + ": " + db.constructionTime + " ms");
    });
    console.log("Initialization fully complete in " + activation_time + " ms.");
}
exports.activate = activate;
function getKeyValueLineId(document, line) {
    let lineText = line.text;
    let commentPos = lineText.indexOf("--");
    if (commentPos != -1)
        lineText = lineText.substring(commentPos);
    lineText = lineText.trim();
    let match = lineText.match(/([^ \t=]*)[ \t]*=[ \t]*([0-9]*)/); // NAME = VAL
    if (match && match.length > 2) {
        let val = match[2];
        let iVal = parseInt(val);
        //console.log(val);
        return iVal;
    }
    if (line.lineNumber + 1 >= document.lineCount)
        return undefined;
    return getKeyValueLineId(document, document.lineAt(line.lineNumber + 1));
}
function sortLuaKeyValTableInSelection() {
    let editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    let document = editor.document;
    let selection = editor.selection;
    let startLine = selection.start.line;
    let endLine = selection.end.line;
    if (selection.start.isEqual(selection.end)) {
        startLine = 0;
        endLine = document.lineCount - 1;
    }
    let lines = new Array();
    for (let l = startLine; l <= endLine; l++)
        lines.push(document.lineAt(l));
    lines = lines.sort((a, b) => {
        let aLineId = getKeyValueLineId(document, a);
        let bLineId = getKeyValueLineId(document, b);
        if (aLineId !== undefined && bLineId !== undefined) {
            if (aLineId > bLineId)
                return 1;
            else if (aLineId < bLineId)
                return -1;
        }
        if (a.lineNumber > b.lineNumber)
            return 1;
        else if (b.lineNumber > a.lineNumber)
            return -1;
        else
            return 0;
    });
    editor.edit(editBuilder => {
        let lineTexts = new Array();
        lines.forEach(l => {
            lineTexts.push(l.text);
        });
        let start = new vscode.Position(startLine, 0);
        let endLine_ = document.lineAt(endLine);
        let end = new vscode.Position(endLine, endLine_.text.length);
        editBuilder.replace(new vscode.Range(start, end), lineTexts.join("\n"));
        vscode.window.showInformationMessage("LUA table has been sorted");
    });
}
// this method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map