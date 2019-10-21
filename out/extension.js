"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
let itemDB;
let mobDB;
let mobSkillDB;
let questDB;
let skillDB;
let skillCastDB;
let scriptFunctionDB = new Map();
let constDB = new Map();
let forceDbColumnHighlight = new Map();
let forceDbColumnHints = new Map();
let fs = require('fs');
let iconv = require('iconv-lite');
let codepage = "win1252";
const is_rAthena = true;
const languageId = "eAthena";
let documentToDecorationTypes = new Map();
let documentToAthenaDBFile = new Map();
// NOTE: need to change wordPattern in language-configuration.json if we change here
let wordPattern = new RegExp("(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\\"\\,\\<\\>\\/\\?\\s]+)");
let serverQuestDbPath;
let athenaNpcDir;
let athenaDbDir;
let wordSeparators;
let itemImageURL;
let mobImageURL;
let skillImageURL;
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
    return [itemDB, mobDB, questDB, skillDB, skillCastDB, mobSkillDB];
}
function initDocumentAthenaDbFile(document) {
    // In case of special databases we just update lines of existing files.
    let autoLoadedDatabases = getAutoLoadedDatabases();
    autoLoadedDatabases.forEach(db => {
        let dbFile = db.findFileByFilePath(document.fileName);
        if (dbFile) {
            dbFile.updateLines(document.getText(), true);
            return dbFile;
        }
    });
    // Otherwise we create a new temporary DB and cache it
    let db;
    if (document.fileName.endsWith("item_db.txt") || document.fileName.endsWith("item_db2.txt"))
        db = new AthenaItemDB([document.fileName]);
    else if (document.fileName.endsWith("mob_db.txt") || document.fileName.endsWith("mob_db2.txt"))
        db = new AthenaMobDB([document.fileName]);
    else if (document.fileName.endsWith("quest_db.txt"))
        db = new AthenaQuestDB([document.fileName]);
    else if (document.fileName.endsWith("skill_db.txt"))
        db = new AthenaSkillDB(document.fileName);
    else if (document.fileName.endsWith("skill_cast_db.txt"))
        db = new AthenaSkillCastDB(document.fileName);
    else if (document.fileName.endsWith("mob_skill_db.txt") || document.fileName.endsWith("mob_skill_db2.txt"))
        db = new AthenaMobSkillDB([document.fileName]);
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
function trimString(str) {
    return str.trim();
    // ����� � ����� ����������� ���������� ��� ������� string.trim()?
    // let start;
    // for ( start = 0; start < str.length; start++ )
    // 	if ( !isWhitespace(str.charAt(start)) )
    // 		break;
    // let end; 
    // for ( end = str.length - 1; end > start; end-- )
    // 	if ( !isWhitespace(str.charAt(end)) )
    // 		break;
    // if ( end < start )
    // 	return "";
    // else
    // 	return str.substring(start, end+1);
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
            if (line.charAt(i) == '\"') {
                while (i < line.length) {
                    i++;
                    if (line.charAt(i) == '\"' && line.charAt(i - 1) != '\"')
                        break;
                }
            }
            else if (line.charAt(i) == '{') {
                let curlyLevel = 1;
                while (curlyLevel > 0 && i < line.length) {
                    i++;
                    if (line.charAt(i) == '{')
                        curlyLevel++;
                    else if (line.charAt(i) == '}')
                        curlyLevel--;
                }
            }
            else if (line.charAt(i) == ',') {
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
    updateLines(text, rebuildIndex) {
        this.lines = new Array(0);
        let strLines = text.split('\n');
        for (let i = 0; i < strLines.length; i++) {
            let dbLine = this.createLine(this.filePath, i, strLines[i]);
            this.lines.push(dbLine);
        }
        if (rebuildIndex)
            this.parentDb.rebuildIndex();
    }
}
class AthenaDB {
    constructor(filePaths, lineDef, keyIndex, nameIndex) {
        this.idToDbLine = new Map();
        this.nameToDbLine = new Map();
        this.alreadyExplainingLine = false; // to display short descriptions for each param if explaining line
        this.files = [];
        this.keyIndex = keyIndex || 0;
        filePaths.forEach(filePath => {
            this.files.push(this.createFile(this, filePath));
        });
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
        }
        if (!nameIndex) {
            if (!is_rAthena && filePaths[0].endsWith("skill_cast_db.txt") || filePaths[0].endsWith("skill_cast_db2.txt"))
                this.nameIndex = 8;
            else if (filePaths[0].endsWith("skill_db.txt") || filePaths[0].endsWith("skill_db2.txt") && !(filePaths[0].endsWith("mob_skill_db.txt") || filePaths[0].endsWith("mob_skill_db2.txt")))
                this.nameIndex = this.getParamIndex("name");
            else
                this.nameIndex = 1;
        }
        else
            this.nameIndex = nameIndex;
        this.rebuildIndex();
    }
    createFile(db, filePath) {
        return new AthenaDBFile(db, filePath);
    }
    rebuildIndex() {
        this.idToDbLine.clear();
        this.nameToDbLine.clear;
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
    explainParamByLineSub(line, paramIdx, modifiedValue) {
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : ("param_" + paramIdx);
        let position = line.paramRanges[paramIdx].start;
        let unmodifiedParamVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (unmodifiedParamVal == modifiedValue) {
            let iParamVal = parseInt(modifiedValue);
            if (iParamVal.toString() == modifiedValue)
                modifiedValue = iParamVal.toLocaleString();
        }
        return makeMarkdownLink(paramName, line.filePath, position.line, position.character) + " : " + modifiedValue;
    }
    explainParamByLine(line, paramIdx) {
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        let iParamVal = parseInt(paramVal);
        if (iParamVal.toString() == paramVal)
            paramVal = iParamVal.toLocaleString();
        return this.explainParamByLineSub(line, paramIdx, paramVal);
    }
    explainLine(line) {
        this.alreadyExplainingLine = true;
        let maxLength = Math.max(this.paramNames.length, line.params.length);
        let ret = "";
        for (let i = 0; i < maxLength; i++) {
            // let paramName = ( i < this.paramNames.length ) ? this.paramNames[i] : "?";
            let paramVal = (i < line.params.length) ? line.params[i].trim() : "";
            if (!paramVal || paramVal == "{}")
                continue;
            if (i != 0)
                ret += "  \n"; //ret += ", ";
            ret += this.explainParamByLine(line, i);
        }
        this.alreadyExplainingLine = false;
        return ret;
    }
    findFileByFilePath(filePath) {
        return this.files.find(f => {
            let ret = fileNamesEqual(f.filePath, filePath);
            // if ( ret )
            // 	console.log("file " + filePath + " have been found.");
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
    getParamDocumentation(paramName) {
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
function explainItemIdParam(paramVal, full) {
    let iParamVal = parseInt(paramVal);
    if (iParamVal < 1)
        return paramVal;
    let itemDbLine = itemDB.idToDbLine.get(parseInt(paramVal));
    if (itemDbLine) {
        if (!full) {
            if (AthenaItemDB.aegisNameParamIndex < itemDbLine.params.length)
                paramVal += " " + itemDbLine.params[AthenaItemDB.aegisNameParamIndex];
            let imageURL = itemImageURL ? itemImageURL.replace("ITEMID", iParamVal.toString()) : iParamVal.toString();
            paramVal = makeMarkdownLinkWithImage(itemDbLine, imageURL, 18, 18) + " " + paramVal;
        }
        else {
            paramVal += "  \n*ItemDB*  \n";
            paramVal += itemDB.explainLine(itemDbLine);
        }
    }
    return paramVal;
}
function isFullyNumericString(str) {
    let i = parseInt(str);
    return i.toString() == str;
}
function explainSkillIdOrTechNameParam(paramVal) {
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
    let ret = makeMarkdownLinkWithImage(dbLine, url, 18, 18) + " " + paramVal;
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
class AthenaItemDB extends AthenaDB {
    constructor(filePaths) {
        super(filePaths);
    }
    explainParamByLine(line, paramIdx) {
        const paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "ID" || paramName == "// ID")
            paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine);
        else if (paramName == "Loc")
            paramVal = explainBinMaskEnumParam(paramVal, EQP);
        else if (paramName == "Type")
            paramVal = explainEnumParam(paramVal, IT);
        else if (paramName == "Job")
            paramVal = explainBinMaskEnumParam(paramVal, item_jobmask);
        else if (paramName == "Weight") {
            paramVal = "" + (parseInt(paramVal) / 10);
        }
        else if (paramName == "View") {
            let typeIdx = -1;
            for (let i = 0; i < this.paramNames.length; i++)
                if (this.paramNames[i] == "Type") {
                    typeIdx = i;
                    break;
                }
            if (typeIdx != -1 && line.params.length >= typeIdx && parseInt(line.params[typeIdx]) == IT.WEAPON)
                paramVal = explainEnumParam(paramVal, weapon_type);
        }
        else if (paramName == "Upper")
            paramVal = explainBinMaskEnumParam(paramVal, item_upper);
        return super.explainParamByLineSub(line, paramIdx, paramVal);
    }
    getParamDocumentation(paramName) {
        if (paramName == "Loc")
            return this.enumToParamDocumentation(EQP, 2);
        else if (paramName == "Type")
            return this.enumToParamDocumentation(IT, 0);
        else if (paramName == "Job")
            return this.enumToParamDocumentation(item_jobmask, 1);
        else if (paramName == "View")
            return "For hats: accessoryId, for weapons:  \n" + this.enumToParamDocumentation(weapon_type, 0);
        else if (paramName == "Upper")
            return this.enumToParamDocumentation(item_upper, 1);
        return undefined;
    }
    getSymbolLabelForLine(l) {
        let id = l.getParamByIndex(AthenaItemDB.itemIdParamIndex);
        let aegisName = l.getParamByIndex(AthenaItemDB.aegisNameParamIndex);
        let engName = l.getParamByIndex(AthenaItemDB.engNameParamIndex);
        let rusName = l.getParamByIndex(AthenaItemDB.rusNameParamIndex);
        if (!id || !aegisName || !engName || !rusName)
            return undefined;
        return id + ":" + aegisName + ":" + engName + ":" + rusName;
    }
}
AthenaItemDB.itemIdParamIndex = 0;
AthenaItemDB.aegisNameParamIndex = 1;
AthenaItemDB.engNameParamIndex = 2;
AthenaItemDB.rusNameParamIndex = 3;
class AthenaMobDB extends AthenaDB {
    constructor(filePaths) {
        super(filePaths, undefined, AthenaMobDB.mobIdParamIndex);
    }
    explainParamByLine(line, paramIdx) {
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "ID") {
            let iParamVal = parseInt(paramVal);
            if (iParamVal > 0) {
                let mobDbLine = mobDB.idToDbLine.get(parseInt(paramVal));
                if (mobDbLine) {
                    if (AthenaMobDB.spriteNameParamIndex < mobDbLine.params.length)
                        paramVal += " (" + mobDbLine.params[AthenaMobDB.spriteNameParamIndex] + ")";
                    let url = mobImageURL ? mobImageURL.replace("MOBID", iParamVal.toString()) : "";
                    paramVal = makeMarkdownLinkWithImage(mobDbLine, url, 32, 32) + " " + paramVal;
                }
            }
        }
        else if (paramName == "Mode")
            paramVal = explainBinMaskEnumParam(paramVal, MD);
        else if (paramName == "Element") {
            let iParamVal = parseInt(paramVal);
            let eleLv = Math.floor(iParamVal / 20);
            let eleNum = iParamVal % 10;
            let paramExplanation = getEnumMemberNameByValue(eleNum, ELE);
            if (paramExplanation)
                paramVal += " (" + paramExplanation + " " + eleLv + ")";
        }
        else if (paramName == "Race")
            paramVal = explainEnumParam(paramVal, RC);
        else if (paramName == "Scale")
            paramVal = explainEnumParam(paramVal, UNIT_SIZE);
        else if (paramName.match("Drop[1-9]id") || paramName.match("MVP[1-9]id") || paramName == "DropCardid") {
            paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine);
        }
        else if (paramName.match("Drop[1-9]per") || paramName.match("MVP[1-9]per") || paramName == "DropCardper") {
            let iVal = parseInt(paramVal);
            let iValDiv = iVal / 100;
            paramVal = iValDiv + "%";
        }
        return super.explainParamByLineSub(line, paramIdx, paramVal);
    }
    getParamDocumentation(paramName) {
        if (paramName == "Mode")
            return this.enumToParamDocumentation(MD, 1);
        else if (paramName == "Element")
            return "ElementLv: value / 20  \nElementType: value % 10  \nTypes:  \n" + this.enumToParamDocumentation(ELE, 0);
        else if (paramName == "Race")
            return this.enumToParamDocumentation(RC, 0);
        else if (paramName == "Scale")
            return this.enumToParamDocumentation(UNIT_SIZE, 0);
        return undefined;
    }
    getSymbolLabelForLine(l) {
        let id = l.getParamByIndex(AthenaMobDB.mobIdParamIndex);
        let spriteName = l.getParamByIndex(AthenaMobDB.spriteNameParamIndex);
        let kROName = l.getParamByIndex(AthenaMobDB.kRONameParamIndex);
        let rusName = l.getParamByIndex(AthenaMobDB.rusNameParamIndex);
        if (!id || !spriteName || !kROName || !rusName)
            return undefined;
        return id + ":" + spriteName + ":" + kROName + ":" + rusName;
    }
    explainLine(line) {
        let addExplanation = "";
        let mobIdStr = line.getParamByIndex(this.keyIndex);
        if (mobIdStr) {
            let mobId = parseInt(mobIdStr);
            if (mobId > 0 && mobSkillDB.mobidToSkillList) {
                let mobSkills = mobSkillDB.mobidToSkillList.get(mobId);
                if (mobSkills && mobSkills.length > 0) {
                    mobSkills.forEach(l => {
                        let skillId = l.getParamByIndex(AthenaMobSkillDB.skillIdParamIdx);
                        if (skillId)
                            addExplanation += "  \n" + makeMarkdownLink("Skill", l.filePath, l.lineNum) + " : " + explainSkillIdOrTechNameParam(skillId) + "  \n";
                    });
                }
            }
        }
        return super.explainLine(line) + addExplanation;
    }
}
AthenaMobDB.mobIdParamIndex = 0;
AthenaMobDB.spriteNameParamIndex = 1;
AthenaMobDB.kRONameParamIndex = 2;
AthenaMobDB.rusNameParamIndex = 4;
class AthenaMobSkillDB extends AthenaDB {
    constructor(fileNames) {
        super(fileNames, undefined, 999, 999);
    }
    explainParamByLine(line, paramIdx) {
        //MOB_ID,dummy value (info only),STATE,SKILL_ID,SKILL_LV,rate (10000 = 100%),casttime,delay,cancelable,target,condition type,condition value,val1,val2,val3,val4,val5,emotion,chat{,increaseRange,castbegin_script,castend_script}
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "MOB_ID") {
            let iVal = parseInt(paramVal);
            if (iVal > 0) {
                let mobDbLine = mobDB.idToDbLine.get(iVal);
                if (mobDbLine)
                    paramVal += " (" + mobDbLine.getParamByIndex(AthenaMobDB.spriteNameParamIndex) + ")"; // "*Mob DB*  \n" + mobDB.explainLine(mobDbLine);
            }
        }
        else if (paramName == "SKILL_ID") {
            paramVal = explainSkillIdOrTechNameParam(paramVal);
        }
        else if (paramName == "rate (10000 = 100%)") {
            paramVal = parseInt(paramVal) / 100 + " %";
        }
        else if (paramName == "casttime" || paramName == "delay")
            paramVal = millisecondsToHumanReadableString(parseInt(paramVal));
        else if (paramName == "dummy value (info only)") {
            if (!this.alreadyExplainingLine) {
                paramVal = this.explainLine(line);
            }
        }
        else if (paramName == "target")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleTargets);
        else if (paramName == "STATE")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleStates);
        else if (paramName == "condition type")
            paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleConditions);
        return this.explainParamByLineSub(line, paramIdx, paramVal);
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
    getParamDocumentation(paramName) {
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
}
AthenaMobSkillDB.dummyNameParamIdx = 1;
AthenaMobSkillDB.skillIdParamIdx = 3;
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
class AthenaSkillDB extends AthenaDB {
    constructor(fileName) {
        super(fileName ? [fileName] : [athenaDbDir + "/skill_db.txt"]);
    }
    explainParamByLine(line, paramIdx) {
        let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
        let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
        if (paramName == "name" || paramName == "id") {
            paramVal = explainSkillIdOrTechNameParam(paramVal);
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
        return this.explainParamByLineSub(line, paramIdx, paramVal);
    }
    getParamDocumentation(paramName) {
        if (paramName == "inf")
            return this.enumToParamDocumentation(INF, 1);
        else if (paramName == "nk")
            return this.enumToParamDocumentation(NK, 1);
        else if (paramName == "inf2")
            return this.enumToParamDocumentation(INF2, 1);
        else if (paramName == "element")
            return this.enumToParamDocumentation(ELE, 0);
    }
    explainLine(line) {
        let result = super.explainLine(line);
        let skillId = parseInt(line.params[this.keyIndex]);
        if (skillId < 1)
            return result;
        let skillCastDbLine = skillCastDB.idToDbLine.get(skillId);
        if (!skillCastDbLine)
            return result;
        result = "*Skill DB*  \n" + result + "  \n*Skill Cast DB*  \n" + skillCastDB.explainLine(skillCastDbLine);
        return result;
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
    if (hours)
        timeStr += " " + hours + "h";
    if (minutes)
        timeStr += " " + minutes + "m";
    if (secondsAndMillis)
        timeStr += " " + (secondsAndMillis / 1000) + "s";
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
    for (let i = 0; i < fileContentBytes.length - 1; i++)
        if (fileContentBytes[i] == '/' && fileContentBytes[i + 1] == '/')
            while (fileContentBytes[i] != '\n' && i < fileContentBytes.length)
                fileContentBytes[i] = ' ';
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
    var fileContent = fs.readFileSync(filePath);
    var lines = fileContent.toString().split(/\r?\n/);
    var myCompletions = new Array();
    var i;
    for (i = 0; i < lines.length; i++) {
        var tokens = lines[i].split("\t");
        if (tokens.length < 2)
            continue; // Invalid file format, should be at least type and label
        const item = new vscode.CompletionItem(tokens[1]);
        var type = parseInt(tokens[0]);
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
                this.params[i] = new AthenaFuncParam(trimString(params[i].substring(0, delim)), trimString(params[i].substring(delim, params[i].length)));
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
    let conf = vscode.workspace.getConfiguration("eathena");
    function getConfValOrThrow(settingName, description) {
        let ret = conf.get(settingName);
        if (!ret) {
            let err = "[" + description + "] setting is not set.";
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
        let conf = vscode.workspace.getConfiguration("eathena");
        mobImageURL = conf.get("mobImageURL");
        itemImageURL = conf.get("itemImageURL");
        skillImageURL = conf.get("skillImageURL");
        defaultAthenaDbColumnHighlighting = conf.get("defaultAthenaDbColumnHighlighting");
        defaultAthenaDbColumnHints = conf.get("defaultAthenaDbColumnHints");
        athenaNpcDir = formatDirNameFromConfig(getConfValOrThrow("athenaNpcDirectory", "eAthena NPC directory"));
        athenaDbDir = formatDirNameFromConfig(getConfValOrThrow("athenaDbDirectory", "eAthena DB directory"));
        itemBonusTxtPath = getConfValOrThrow("itemBonusTxtPath", "item_bonus.txt path");
        questid2displaypath = getConfValOrThrow("clientQuestid2displayPath", "Client questid2display.txt path");
        codepage = getConfValOrThrow("encoding", "Encoding");
        itemDbFilePaths = getDbFilePathsFromConfiguration("itemDbRelativePath", "ItemDB Relative Path(s)");
        mobDbFilePaths = getDbFilePathsFromConfiguration("mobDbRelativePath", "MobDB Relative Path(s)");
        mobSkillDbFilePaths = getDbFilePathsFromConfiguration("mobSkillDbRelativePath", "MobSkillDB Relative Path(s)");
        constDBFilePath = athenaDbDir + "/" + getConfValOrThrow("constDbRelativePath", "Const DB relative path");
    }
    updateSettingsFromConfiguration();
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("eathena")) {
            conf = vscode.workspace.getConfiguration("eathena");
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
    loadConstDB(constDBFilePath, is_rAthena ? getConfValOrThrow("scriptConstantsHppPath", "script_constants.hpp path") : undefined);
    const itemBonusDB = is_rAthena ? new ItemBonusDB_rAthena(itemBonusTxtPath) : new ItemBonusDB([itemBonusTxtPath]);
    let completionsTxtFn = context.extensionPath + "/res/completions.txt";
    if (!fs.existsSync(completionsTxtFn))
        syncWithAthena();
    let allCompletions = readCompletionsArrayFromFile(completionsTxtFn);
    mobDB.idToDbLine.forEach(element => {
        const mobName = element.params[AthenaMobDB.spriteNameParamIndex];
        const mobId = element.params[AthenaMobDB.mobIdParamIndex];
        const completionItem = new AthenaDbCompletionItem(mobName, vscode.CompletionItemKind.Unit, mobDB, element);
        completionItem.filterText = mobName + " " + mobId;
        completionItem.detail = mobId;
        allCompletions.push(completionItem);
    });
    itemDB.idToDbLine.forEach(element => {
        const itemName = element.params[AthenaItemDB.aegisNameParamIndex];
        const itemId = element.params[AthenaItemDB.itemIdParamIndex];
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
                let itemID = itemDbLine.params[AthenaItemDB.itemIdParamIndex];
                result = result.concat(findWordReferencesInAllFiles([itemID, word]));
            }
            let mobDbLine = mobDB.nameToDbLine.get(word);
            if (!mobDbLine && wordInt > 0)
                mobDbLine = mobDB.idToDbLine.get(wordInt);
            if (mobDbLine) {
                let mobId = mobDbLine.params[AthenaMobDB.mobIdParamIndex];
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
                return new GetFunctionAndParameterInfoResult(functionInfo, activeParameter);
            if (activeParameter == -1)
                activeParameter = 0;
            lineOfs--;
        }
        return null;
    }
    let signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(languageId, {
        provideSignatureHelp(document, position, token, context) {
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
                    info.parameters.push(new vscode.ParameterInformation(paramLabel));
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
                let parsedLine = dbFile.lines[position.line];
                let activeParam = -1;
                for (let i = 0; i < parsedLine.paramRanges.length; i++) {
                    if (parsedLine.paramRanges[i].contains(position)) {
                        activeParam = i;
                        break;
                    }
                }
                let ret = new vscode.SignatureHelp();
                let infos = new Array();
                let signatureLabel = "";
                dbFile.parentDb.paramNames.forEach(p => {
                    signatureLabel += "[" + p + "] ";
                });
                let info = new vscode.SignatureInformation(signatureLabel);
                dbFile.parentDb.paramNames.forEach(p => {
                    info.parameters.push(new vscode.ParameterInformation("[" + p + "]", dbFile.parentDb.getParamDocumentation(p)));
                });
                infos.push(info);
                ret.signatures = infos;
                ret.activeSignature = 0;
                if (activeParam != -1)
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
    let hoverProvider = vscode.languages.registerHoverProvider(languageId, {
        provideHover(document, position, token) {
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
                            colHint += "  \n" + db.explainParamByLine(parsedLine, i);
                        colHint += "  \n  \n";
                        break;
                    }
            }
            let wordRange = document.getWordRangeAtPosition(position, wordPattern);
            let word = document.getText(wordRange);
            let wordInt = parseInt(word);
            let functionInfo = scriptFunctionDB.get(word);
            if (functionInfo != null) {
                return new vscode.Hover(colHint + functionInfo.getLabel(), wordRange);
            }
            let DBs = [itemDB, mobDB, skillDB];
            for (let i = 0; i < DBs.length; i++) { // no foreach because we use return which cant be used inside foreach
                let dbLine = DBs[i].nameToDbLine.get(word);
                if (dbLine) {
                    colHint += "*" + dbLine.filePath + "*" + "  \n" + DBs[i].explainLine(dbLine);
                }
            }
            let itemBonusExplanation = itemBonusDB.explainBonus(word);
            if (itemBonusExplanation)
                return new vscode.Hover(colHint + itemBonusExplanation, wordRange);
            let constDbEntry = constDB.get(word.toLowerCase());
            if (constDbEntry) {
                let val = "*script constant* " + constDbEntry.name;
                if (constDbEntry.val != undefined)
                    val += " = " + constDbEntry.val;
                return new vscode.Hover(colHint + val, wordRange);
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
                    str = "**server**  \n" + strServer + "**client**  \n" + strClient;
                else if (strServer)
                    str = strServer;
                else if (strClient)
                    str = strClient;
                if (str.length)
                    return new vscode.Hover(colHint + str, wordRange);
            }
            if (wordInt && funcInfo && funcInfo.activeParameter != -1) {
                if (paramNameLowerCase == "mob_id" || paramNameLowerCase == "mobid" || paramNameLowerCase == "mob" || paramNameLowerCase == "monster" || paramNameLowerCase == "class_" || paramNameLowerCase == "class") {
                    let mobDbLine = mobDB.idToDbLine.get(wordInt);
                    if (mobDbLine)
                        return new vscode.Hover(colHint + mobDB.explainLine(mobDbLine), wordRange);
                }
                else if (paramNameLowerCase == "itemid" || paramNameLowerCase == "itid" || paramNameLowerCase == "item") {
                    let itemDbLine = itemDB.idToDbLine.get(wordInt);
                    if (itemDbLine)
                        return new vscode.Hover(colHint + itemDB.explainLine(itemDbLine), wordRange);
                }
            }
            if (colHint)
                return new vscode.Hover(colHint, wordRange);
            return null;
        }
    });
    let completionProvider = vscode.languages.registerCompletionItemProvider("*", {
        resolveCompletionItem(item, token) {
            if (item instanceof AthenaDbCompletionItem) {
                if (!item.documentation)
                    item.documentation = new vscode.MarkdownString(item.db.explainLine(item.dbLine));
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
            return new Promise((resolve, reject) => {
                let symbols = new Array();
                let text = document.getText();
                let curlyCount = 0;
                let isString = false;
                let openCurlyOffset = -1; // Current symbol beginning
                let label = "";
                let bodyStart = 0, bodyEnd = 0;
                if (isDocumentAthenaDB(document)) {
                    let dbFile = ensureDocumentAthenaDbFile(document);
                    let db = dbFile.parentDb;
                    let n = 0;
                    dbFile.lines.forEach(l => {
                        let label = db.getSymbolLabelForLine(l);
                        if (label) {
                            let symbol = new vscode.SymbolInformation(label, vscode.SymbolKind.Variable, document.fileName, new vscode.Location(document.uri, new vscode.Range(l.paramRanges[0].start, l.paramRanges[l.paramRanges.length - 1].end)));
                            symbols.push(symbol);
                            n++;
                        }
                    });
                    //console.log("total symbols: " + n);
                    resolve(symbols);
                    return;
                }
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
                        var beginningOfLine = getBeginningOfLinePosition(text, i);
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
                        bodyStart = beginningOfLine;
                        bodyEnd = i;
                    }
                    if (type != -1) {
                        let position = new vscode.Range(document.positionAt(bodyStart), document.positionAt(bodyEnd));
                        let symbol = new vscode.SymbolInformation(label, type, document.fileName, new vscode.Location(document.uri, position));
                        symbols.push(symbol);
                        type = -1;
                    }
                }
                resolve(symbols);
            });
        }
    });
    context.subscriptions.push(completionProvider, navProvider, hoverProvider, gotoDefinitionProvider, referenceProvider, copySearchRegexCmd, signatureHelpProvider);
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
        if (!isDocumentAthenaDB(document))
            return;
        let enableHighlight = forceDbColumnHighlight.get(document.fileName);
        if (enableHighlight == null)
            enableHighlight = isDocumentAthenaDB(document) && defaultAthenaDbColumnHighlighting;
        let enableHints = forceDbColumnHints.get(document.fileName);
        if (enableHints == null)
            enableHints = isDocumentAthenaDB(document) && defaultAthenaDbColumnHints;
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
    vscode.workspace.onDidChangeTextDocument(event => {
        let document = event.document;
        let dbFile = isDocumentAthenaDB(document) ? ensureDocumentAthenaDbFile(document) : null;
        if (dbFile) {
            for (let i = 0; i < event.contentChanges.length; i++) {
                let change = event.contentChanges[i];
                for (let l = change.range.start.line; l <= change.range.end.line; l++)
                    dbFile.updateLine(document, l);
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
        let scriptCppPath = getConfValOrThrow("scriptCppPath", "script.cpp path");
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
    console.log("Initialization fully complete in " + activation_time + " ms (item_db: " + item_db_time + " ms, mob_db: " + mob_db_time + " ms)");
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