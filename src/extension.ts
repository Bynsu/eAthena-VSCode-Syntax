// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import { Dirent } from 'fs';
import * as iconv from 'iconv-lite';
import * as vscode from 'vscode';

let itemDB : AthenaItemDB;
let mobDB : AthenaMobDB;
let mobSkillDB : AthenaMobSkillDB;
let questDB : AthenaQuestDB;
let skillDB : AthenaSkillDB;
let skillCastDB : AthenaSkillCastDB;
let itemTradeDB : AthenaItemTradeDB;

let scriptFunctionDB = new Map<string, AthenaFunctionInfo>();

let constDB = new Map<string, AthenaConst>();

let forceDbColumnHighlight = new Map<string, boolean>();
let forceDbColumnHints = new Map<string, boolean>();

let codepage = "win1252";

let is_rAthena = false;

const languageId = "eAthena";
const languageIdLowerCase = "eathena";

let documentToDecorationTypes = new Map<vscode.TextDocument, vscode.TextEditorDecorationType[]>(); 
let documentToAthenaDBFile = new Map<vscode.TextDocument, AthenaDBFile>();

// NOTE: need to change wordPattern in language-configuration.json if we change here
let wordPattern = new RegExp("(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\\"\\,\\<\\>\\/\\?\\s]+)");
let serverQuestDbPath : string;
let athenaDir : string;
let athenaNpcDir : string;
let athenaDbDir : string;
let wordSeparators : string;

let itemImageURL : string|undefined;
let mobImageURL : string|undefined;
let skillImageURL : string|undefined; 

let webviewPanel : vscode.WebviewPanel|undefined;
let webviewPanelEditor : vscode.TextEditor;
let webviewPanelLineNum : number|undefined;
let webviewPanelActiveParam : number|undefined;

class AthenaConst {
	name : string;
	val : number|undefined;
	constructor (name : string, val : number|undefined) {
		this.name = name;
		this.val = val;
	}
}

function formatFileName(fn : string) : string {
	return fn.replace(/\\/g, "/").toLowerCase();
}


function fileNamesEqual(fn1 : string, fn2 : string) : boolean {
	return formatFileName(fn1) == formatFileName(fn2);
}

function getAutoLoadedDatabases() : Array<AthenaDB>
{
	return [ itemDB, mobDB, questDB, skillDB, skillCastDB, mobSkillDB, itemTradeDB];
}

function initDocumentAthenaDbFile(document : vscode.TextDocument) : AthenaDBFile
{
	// In case of special databases we just update lines of existing files.
	let autoLoadedDatabases = getAutoLoadedDatabases();
	for ( let i = 0; i < autoLoadedDatabases.length; i++ ) { // no foreach to allow preemptive return
		let dbFile = autoLoadedDatabases[i].findFileByFilePath(document.fileName);
		if ( dbFile ) {
			dbFile.updateLines(document.getText(), true);
			return dbFile;
		}
	}

	// Otherwise we create a new temporary DB and cache it
	// Guess DB type by file name
	let db : AthenaDB;
	if ( document.fileName.endsWith("item_db.txt") || document.fileName.endsWith("item_db2.txt") )
		db = new AthenaItemDB([document.fileName]);
	else if ( document.fileName.endsWith("mob_db.txt") || document.fileName.endsWith("mob_db2.txt") )
		db = new AthenaMobDB([document.fileName]);
	else if ( document.fileName.endsWith("quest_db.txt") )
		db = new AthenaQuestDB([document.fileName]);
	else if ( document.fileName.endsWith("mob_skill_db.txt") || document.fileName.endsWith("mob_skill_db2.txt") ) // needs to be before skill_db to avoid mistaking mob_skill_db for skill_db
		db = new AthenaMobSkillDB([document.fileName]);
	else if ( document.fileName.endsWith("skill_db.txt") )
		db = new AthenaSkillDB(document.fileName);
	else if ( document.fileName.endsWith("skill_cast_db.txt") )
		db = new AthenaSkillCastDB(document.fileName);
	else if ( document.fileName.endsWith("item_trade.txt") )
		db = new AthenaItemTradeDB(document.fileName);
	else
		db = new AthenaDB([document.fileName]);

	documentToAthenaDBFile.set(document, db.files[0]);
	return db.files[0];
}

function ensureDocumentAthenaDbFile(document : vscode.TextDocument) : AthenaDBFile
{
	let autoLoadedDBs = getAutoLoadedDatabases();
	for ( let i = 0; i < autoLoadedDBs.length; i++ ) {
		let f = autoLoadedDBs[i].findFileByFilePath(document.fileName);
		if ( f )
			return f;
	}	
	return documentToAthenaDBFile.get(document) || initDocumentAthenaDbFile(document);
}

function makeHTMLLink(visibleText : string, filePath : string, lineNum0based : number, position0based? : number) : string
{
	let uri = vscode.Uri.file(filePath);
	let filePathWithPosition = uri + "#" + (lineNum0based+1);
	if ( position0based )
		filePathWithPosition +=","+(position0based+1);

	return "<a href='#' onclick='selectParameter(\""+ visibleText +"\");' id='"+ visibleText +"'>" + visibleText + "</a>";
}


function makeMarkdownLink(visibleText : string, filePath : string, lineNum0based : number, position0based? : number) : string
{
	let uri = vscode.Uri.file(filePath);
	let filePathWithPosition = uri + "#" + (lineNum0based+1);
	if ( position0based )
		filePathWithPosition +=","+(position0based+1);

	return "["+visibleText+"](" + filePathWithPosition + ")";
}


function makeMarkdownLinkWithImage(dbLine : AthenaDBLine, imageURL : string, height : number, width : number) {
	return makeMarkdownLink("![image]("+imageURL+"|height="+height+",width="+width+" '"+ dbLine.filePath + ":" + (dbLine.lineNum+1) +"')", dbLine.filePath, dbLine.lineNum);
}


function isWhitespace(str : string) : boolean
{
	for ( let i = 0; i < str.length; i++ )
		if ( str.charAt(i) != ' ' && str.charAt(i) != '\t' && str.charAt(i) != '\r' && str.charAt(i) != '\n' )
			return false;
	return true;
}


class AthenaDBLine {
	filePath : string;
	lineNum : number; // 0-based
	lineStr : string;
	params : Array<string> = new Array<string>(0);
	paramRanges : Array<vscode.Range> = new Array<vscode.Range>(0);
	comment! : string;
	
	constructor(filePath : string, lineNum : number, line : string) {
		this.filePath = filePath;
		this.lineNum = lineNum;
		this.lineStr = line;


		let comment = false;
		let paramStart = 0;
		let i = 0;

		for ( ; i < line.length; i++ ) {
			if ( i < line.length - 1 && line.charAt(i) == '/' && line.charAt(i+1) == '/' ) {
				comment = true;
				break;
			}

			let c = line.charAt(i);

			if ( c == '\"' ) {
				while ( i < line.length ) {
					i++;
					if ( line.charAt(i) == '\"' && line.charAt(i-1) != '\"' )
						break;
				}
			} else if ( c == '{' ) {
				let curlyLevel = 1;				
				while ( curlyLevel > 0 && i < line.length ) {
					i++
					if ( line.charAt(i) == '{' )
						curlyLevel++;
					else if ( line.charAt(i) == '}' )
						curlyLevel--;
				}
			} else if ( c == ',' ) {
				this.params.push(line.substring(paramStart, i).trim());
				this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
				paramStart = i+1;
			}
		}

		if ( comment ) {
			// Whitespace before comment goes to "comment" as well
			do {
				i--;
			} while ( i >= 0 && isWhitespace(line.charAt(i)) );
			i++; // Skip last non-whitespace character
			if ( paramStart != 0 ) {
				this.params.push(line.substring(paramStart, i).trim());
				this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
			}
			this.comment = line.substring(i);
		} else
			if ( paramStart != 0 ) {
				this.params.push(line.substring(paramStart, i).trim());
				this.paramRanges.push(new vscode.Range(lineNum, paramStart, lineNum, i));
			}
	}

	getParamByIndex(index : number) : string|undefined {
		return index < this.params.length ? this.params[index] : undefined;
	}

	getIntParamByIndex(index : number) : number|undefined {
		let val = this.getParamByIndex(index);
		return val ? parseInt(val) : undefined;		
	}

	getParamIdxAtPosition(position : vscode.Position) : number | undefined {
		for ( let i = 0; i < this.paramRanges.length; i++ )
			if ( this.paramRanges[i].contains(position) )
				return i;
		return undefined;
	}
}

class AthenaDBFile {
	parentDb : AthenaDB;
	filePath : string;
	lines : AthenaDBLine[];
	symbols : vscode.SymbolInformation[];	

	constructor(parentDb : AthenaDB, filePath : string)
	{

		if ( !fs.existsSync(filePath) ) {
			let error = "AthenaDB: " + filePath + " not exists";
			vscode.window.showErrorMessage(error);
			throw new Error(error);
		}

		this.parentDb = parentDb;
		this.filePath = filePath;
		this.lines = [];
		this.symbols = [];

		let fileContentBytes = fs.readFileSync(filePath);
		let fileContent : string = iconv.decode(fileContentBytes, codepage);

		this.updateLines(fileContent, false);
	}

	createLine(filePath : string, lineNum : number, line : string) : AthenaDBLine {
		return new AthenaDBLine(filePath, lineNum, line); 
	}

	updateLine(document : vscode.TextDocument, lineNum : number) {
		if ( lineNum >= this.lines.length ) {
			this.updateLines(document.getText(), true);
			return;
		}

		let newLine = this.createLine(this.filePath, lineNum, document.lineAt(lineNum).text);
		let prevLine = this.lines[lineNum]; 
		let prevKey = prevLine.getParamByIndex(this.parentDb.keyIndex);
		let newKey = newLine.getParamByIndex(this.parentDb.keyIndex);
		if ( prevKey != newKey ) {
			this.updateLines(document.getText(), true);
			return;
		}

		this.lines[lineNum] = newLine;
		// Update index if needed
		if ( prevKey ) {
			let iPrevKey = parseInt(prevKey);
			if ( prevLine == this.parentDb.idToDbLine.get(iPrevKey) ) {
				this.parentDb.idToDbLine.set(iPrevKey, newLine);
				let prevName = prevLine.getParamByIndex(this.parentDb.nameIndex);
				let newName = newLine.getParamByIndex(this.parentDb.nameIndex);
				if ( prevName )
					this.parentDb.nameToDbLine.delete(prevName);
				if ( newName )
					this.parentDb.nameToDbLine.set(newName, newLine);
			}
		}
	}

	updateLines(text : string, rebuildParentDbIndex : boolean) {
		this.lines = new Array<AthenaDBLine>(0);
		let strLines = text.split('\n');
		for ( let i = 0; i < strLines.length; i++ ) {
			let dbLine = this.createLine(this.filePath, i, strLines[i]);
			this.lines.push(dbLine);
		}

		this.symbols = [];
		this.lines.forEach(l => {
			let label = this.parentDb.getSymbolLabelForLine(l);
			if ( label ) {
				// let symbol = new vscode.SymbolInformation(label,
				// 	vscode.SymbolKind.Variable,
				// 	this.filePath,
				// 	new vscode.Location(vscode.Uri.file(this.filePath), new vscode.Range(l.paramRanges[0].start, l.paramRanges[l.paramRanges.length-1].end)));

				let range = new vscode.Range(l.paramRanges[0].start, l.paramRanges[l.paramRanges.length-1].end);
				let symbol = new vscode.SymbolInformation(label,
					vscode.SymbolKind.Variable,
					range,
					vscode.Uri.file(this.filePath));
				this.symbols.push(symbol);
			}
		});

		if ( rebuildParentDbIndex )
			this.parentDb.rebuildIndex();
	}

	getParamIdxAtPosition(position : vscode.Position) : number|undefined {
		if ( position.line < 0 || position.line >= this.lines.length )
			return undefined;
		
		let line = this.lines[position.line];
		return line.getParamIdxAtPosition(position);
	}
}

class AthenaDB {
	files : AthenaDBFile[];
	paramNames : Array<string>;
	idToDbLine = new Map<number,AthenaDBLine>();
	nameToDbLine = new Map<string,AthenaDBLine>();

	keyIndex : number;
	nameIndex : number;

	alreadyExplainingLine = false; // to display short descriptions for each param if explaining line

	constructionTime : number;

	constructor(filePaths : Array<string>, lineDef? : string, keyIndex? : number, nameIndex? : number) {
		let startTime = new Date().getTime();

		this.files = [];

		this.keyIndex = keyIndex || 0;
		this.nameIndex = nameIndex || 1;
	
		// Initialize
		filePaths.forEach(filePath => {
			this.files.push(this.createFile(this, filePath));
		});

		// Set parameter names
		if ( lineDef )
			this.paramNames = lineDef.split(',');
		else {
			let testLines = this.files[0].lines;
			let isLineDefOnNextLine = false;
			let paramNamesLine = null;
			for ( let i = 0; i < 20 && i < testLines.length-1; i++ ) {
				let lineText = testLines[i].lineStr;
				if ( (isLineDefOnNextLine || i == 0) && lineText.startsWith("//") && lineText.includes(",") ) {
					paramNamesLine = lineText.trim();
					break;
				}
				else if ( lineText.toLowerCase().startsWith("// structure of database") ) {
					isLineDefOnNextLine = true;
					continue;
				}
			}
			if ( paramNamesLine ) 
				this.paramNames = paramNamesLine.substr(2).trim().split(",");
			else
				this.paramNames = new Array<string>();
			for ( let i = 0; i < this.paramNames.length; i++ )
				this.paramNames[i] = this.paramNames[i].trim();
		}

		this.rebuildIndex();

		this.constructionTime = new Date().getTime() - startTime;
	}

	createFile(db : AthenaDB, filePath : string) {
		return new AthenaDBFile(db, filePath);
	}

	rebuildIndex() {
		this.idToDbLine.clear();
		this.nameToDbLine.clear();
		this.files.forEach(f => {
			f.lines.forEach(l => {
				if ( this.keyIndex < l.params.length && l.params[this.keyIndex] )
					this.idToDbLine.set(parseInt(l.params[this.keyIndex]), l);
				if ( this.nameIndex < l.params.length )
					this.nameToDbLine.set(l.params[this.nameIndex].trim(), l);
			});
		});
	}

	getParamIndex(paramName : string) : number 
	{
		for ( let i = 0; i < this.paramNames.length; i++ )
			if ( this.paramNames[i] == paramName )
				return i;
		return -1;
	}

	tryGetParamOfLineByKey(key : number, paramName : string)
	{
		const line = this.idToDbLine.get(key);
		if ( line == undefined )
			return "";
		for ( let i = 0; i < line.params.length && i < this.paramNames.length; i++ )
			if ( paramName === this.paramNames[i] )
				return line.params[i];
		return "";
	}

	explainParamByLineSub(line : AthenaDBLine, paramIdx : number, modifiedValue : string, html : boolean) {
		let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : ("param_" + paramIdx);
		let position = line.paramRanges[paramIdx].start;
		
		let unmodifiedParamVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
		if ( unmodifiedParamVal == modifiedValue ) {
			let iParamVal = parseInt(modifiedValue);
			if ( iParamVal.toString() == modifiedValue )
				modifiedValue = iParamVal.toLocaleString();
		}
		
		return html ? 
			makeHTMLLink(paramName, line.filePath, position.line, position.character) + ": " + modifiedValue 
		  : makeMarkdownLink(paramName, line.filePath, position.line, position.character) + " : " + modifiedValue;
	}

	explainParamByLine(line : AthenaDBLine, paramIdx : number, html : boolean) {
		let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";

		let iParamVal = parseInt(paramVal);
		if ( iParamVal.toString() == paramVal )
			paramVal = iParamVal.toLocaleString();

		return this.explainParamByLineSub(line, paramIdx, paramVal, html);
	}


	explainLine(line : AthenaDBLine, html : boolean, cursorPosition? : vscode.Position) : string
	{
		this.alreadyExplainingLine = true;

		let maxLength = Math.max(this.paramNames.length,line.params.length);
		let ret = "";
		if ( html )
			ret += `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Athena Line Preview</title>
			</head>
			<body>`;


			
		let activeParam = undefined;
		if ( cursorPosition != undefined ) 
			activeParam = line.getParamIdxAtPosition(cursorPosition);

		for ( let i = 0; i < maxLength; i++ ) {
			let paramVal = ( i < line.params.length ) ? line.params[i].trim() : "";

			if ( !paramVal || paramVal == "{}" )
				continue;

			if ( i != 0 )
				ret += html ? "<br>" : "  \n";
			if ( html && activeParam != undefined && i == activeParam )
				ret += "<b>"

			ret += this.explainParamByLine(line, i, html);

			if ( html && activeParam != undefined && i == activeParam )
				ret += "</b>"
		}

		this.alreadyExplainingLine = false;

		if ( html )
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

	findFileByFilePath(filePath : string) : AthenaDBFile|undefined {
		return this.files.find(f => {
			let ret = fileNamesEqual(f.filePath, filePath);
			return ret;
		});
	}

	getSymbolLabelForLine(l : AthenaDBLine) : string|undefined {
		let id = l.getParamByIndex(this.keyIndex);
		let name = l.getParamByIndex(this.nameIndex);
		if ( id && name )
			return id + ":" + name.trim();
		else
			return undefined;
	}

	getParamDocumentation(paramIdx : number) : string|undefined {
		return undefined;
	}
	
	// hexType = 0: show only decimal
	// hexType = 1: show only hex
	// hexType = 2: show hex and decimal
	enumToParamDocumentation(typeEnum : any, hexType : number) {
		let paramDocumentation = "";
		for ( let member in typeEnum ) {
			if ( parseInt(member).toString() == member) { // is number
				let num = parseInt(member);
				paramDocumentation += typeEnum[num] + " = ";
				if ( hexType == 0 ) 
					paramDocumentation += num;
				else if ( hexType == 1 )
					paramDocumentation += "0x" + num.toString(16);
				else 
					paramDocumentation += "0x" + num.toString(16) + " (" + num + ")";
				paramDocumentation += "  \n";
			}
		}
		
		return paramDocumentation;
	}
}


enum AthenaItemTradeDBTradeMask {
	NODROP = 1,
	NOTRADE = 2,
	ALLOW_PARTNER_TRADE = 4,
	NOSELLNPC = 8,
	NOCART = 16,
	NOSTORAGE = 32,
	NOGUILDSTORAGE = 64,
	ALLOW_DROP_INSTANCE_TRANSFER = 128,
}

enum rAthenaItemTradeDBTradeMask {
	NODROP = 1,
	NOTRADE = 2,
	ALLOW_PARTNER_TRADE = 4,
	NOSELLNPC = 8,
	NOCART = 16,
	NOSTORAGE = 32,
	NOGUILDSTORAGE = 64,
	NOMAIL = 128,
	NOAUCTION = 256,
}


enum AthenaItemTradeDBColumns {
	ItemId,
	TradeMask,
	GmOverride
}

class AthenaItemTradeDB extends AthenaDB {

	constructor(fileName? : string) {
		super([fileName || (athenaDbDir + "/item_trade.txt")]);
	}

	explainParamByLine(line: AthenaDBLine, paramIdx: number, html : boolean) : string {
		let paramVal = line.getParamByIndex(paramIdx);
		if ( !paramVal )
			return "";

		if ( paramIdx == AthenaItemTradeDBColumns.ItemId ) {
			paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine, html);
		} else if ( paramIdx == AthenaItemTradeDBColumns.TradeMask ) {
			paramVal = explainBinMaskEnumParam(paramVal, is_rAthena ? rAthenaItemTradeDBTradeMask : AthenaItemTradeDBTradeMask);
		}
		return super.explainParamByLineSub(line, paramIdx, paramVal, html);
	}

	getParamDocumentation(paramIdx: number): string | undefined {
		if ( paramIdx == AthenaItemTradeDBColumns.TradeMask )
			return this.enumToParamDocumentation(is_rAthena ? rAthenaItemTradeDBTradeMask : AthenaItemTradeDBTradeMask, 0); 
	}
}

enum EQP {
	HEAD_LOW			= 0x00000001,
	HAND_R				= 0x00000002,
	GARMENT				= 0x00000004,
	ACC_L				= 0x00000008,
	ARMOR				= 0x00000010, //16
	HAND_L				= 0x00000020, //32
	SHOES				= 0x00000040, //64
	ACC_R				= 0x00000080, //128
	HEAD_TOP			= 0x00000100, //256
	HEAD_MID			= 0x00000200, //512
	HEAD_TOP_COSTUME	= 0x00000400, //1024
	HEAD_MID_COSTUME	= 0x00000800, //2048
	HEAD_LOW_COSTUME	= 0x00001000, //4096
	GARMENT_COSTUME		= 0x00002000, //8192
	//LOCATION_COSTUME_FLOOR= 0x00004000,
	AMMO				= 0x00008000, //32768
	ARMOR_COSTUME		= 0x00010000,
	HAND_R_COSTUME		= 0x00020000,
	HAND_L_COSTUME		= 0x00040000,
	SHOES_COSTUME		= 0x00080000,
	ACC_L_COSTUME		= 0x00100000,
	ACC_R_COSTUME		= 0x00200000,
};

enum IT_rA {
	HEALING = 0,				//IT_HEAL				= 0x00
	UNKNOWN, //1				//IT_SCHANGE			= 0x01
	USABLE,  //2				//IT_SPECIAL			= 0x02
	ETC,     //3				//IT_EVENT				= 0x03
	WEAPON,  //4				//IT_ARMOR				= 0x04
	ARMOR,   //5				//IT_WEAPON				= 0x05
	CARD,    //6				//IT_CARD				= 0x06
	PETEGG,  //7				//IT_QUEST				= 0x07
	PETARMOR,//8				//IT_BOW				= 0x08
	UNKNOWN2,//9				//IT_BOTHHAND			= 0x09
	AMMO,    //10			//IT_ARROW				= 0x0a
	DELAYCONSUME,//11		//IT_ARMORTM			= 0x0b
	SHADOWGEAR,//12			//IT_ARMORTB			= 0x0c
							//IT_ARMORMB			= 0x0d
							//IT_ARMORTMB			= 0x0e
							//IT_GUN				= 0x0f
							//IT_AMMO				= 0x10
	THROWWEAPON = 17,		//IT_THROWWEAPON		= 0x11
	CASH,					//IT_CASH_POINT_ITEM	= 0x12
	CANNONBALL,				//IT_CANNONBALL			= 0x13
	MAX 
};

enum IT {
	HEALING = 0,				//IT_HEAL				= 0x00
	UNKNOWN, //1				//IT_SCHANGE			= 0x01
	USABLE,  //2				//IT_SPECIAL			= 0x02
	ETC,     //3				//IT_EVENT				= 0x03
	WEAPON,  //4				//IT_ARMOR				= 0x04
	ARMOR,   //5				//IT_WEAPON				= 0x05
	CARD,    //6				//IT_CARD				= 0x06
	PETEGG,  //7				//IT_QUEST				= 0x07
	PETARMOR,//8				//IT_BOW				= 0x08
	UNKNOWN2,//9				//IT_BOTHHAND			= 0x09
	AMMO,    //10			//IT_ARROW				= 0x0a
	DELAYCONSUME,//11		//IT_ARMORTM			= 0x0b
	SHADOWGEAR,//12			//IT_ARMORTB			= 0x0c
							//IT_ARMORMB			= 0x0d
							//IT_ARMORTMB			= 0x0e
							//IT_GUN				= 0x0f
							//IT_AMMO				= 0x10
	THROWWEAPON = 17,		//IT_THROWWEAPON		= 0x11
	CASH,					//IT_CASH_POINT_ITEM	= 0x12
	CANNONBALL,				//IT_CANNONBALL			= 0x13
	MAX 
};

function getITEnumType() {
	return is_rAthena ? IT_rA : IT;
}

enum JOB {
	NOVICE,
	SWORDMAN,
	MAGE,
	ARCHER,
	ACOLYTE,
	MERCHANT,
	THIEF,
	KNIGHT,
	PRIEST,
	WIZARD,
	BLACKSMITH,
	HUNTER,
	ASSASSIN,
	KNIGHT2,
	CRUSADER,
	MONK,
	SAGE,
	ROGUE,
	ALCHEMIST,
	BARD,
	DANCER,
	CRUSADER2,
	WEDDING,
	SUPER_NOVICE,
	GUNSLINGER,
	NINJA,
	XMAS,
	SUMMER,
	HANBOK,
	OKTOBERFEST,
	SUMMER2,
	MAX_BASIC,

	NOVICE_HIGH = 4001,
	SWORDMAN_HIGH,
	MAGE_HIGH,
	ARCHER_HIGH,
	ACOLYTE_HIGH,
	MERCHANT_HIGH,
	THIEF_HIGH,
	LORD_KNIGHT,
	HIGH_PRIEST,
	HIGH_WIZARD,
	WHITESMITH,
	SNIPER,
	ASSASSIN_CROSS,
	LORD_KNIGHT2,
	PALADIN,
	CHAMPION,
	PROFESSOR,
	STALKER,
	CREATOR,
	CLOWN,
	GYPSY,
	PALADIN2,

	BABY,
	BABY_SWORDMAN,
	BABY_MAGE,
	BABY_ARCHER,
	BABY_ACOLYTE,
	BABY_MERCHANT,
	BABY_THIEF,
	BABY_KNIGHT,
	BABY_PRIEST,
	BABY_WIZARD,
	BABY_BLACKSMITH,
	BABY_HUNTER,
	BABY_ASSASSIN,
	BABY_KNIGHT2,
	BABY_CRUSADER,
	BABY_MONK,
	BABY_SAGE,
	BABY_ROGUE,
	BABY_ALCHEMIST,
	BABY_BARD,
	BABY_DANCER,
	BABY_CRUSADER2,
	SUPER_BABY,

	TAEKWON,
	STAR_GLADIATOR,
	STAR_GLADIATOR2,
	SOUL_LINKER,

	GANGSI,
	DEATH_KNIGHT,
	DARK_COLLECTOR,

	RUNE_KNIGHT = 4054,
	WARLOCK,
	RANGER,
	ARCH_BISHOP,
	MECHANIC,
	GUILLOTINE_CROSS,

	RUNE_KNIGHT_T,
	WARLOCK_T,
	RANGER_T,
	ARCH_BISHOP_T,
	MECHANIC_T,
	GUILLOTINE_CROSS_T,

	ROYAL_GUARD,
	SORCERER,
	MINSTREL,
	WANDERER,
	SURA,
	GENETIC,
	SHADOW_CHASER,

	ROYAL_GUARD_T,
	SORCERER_T,
	MINSTREL_T,
	WANDERER_T,
	SURA_T,
	GENETIC_T,
	SHADOW_CHASER_T,

	RUNE_KNIGHT2,
	RUNE_KNIGHT_T2,
	ROYAL_GUARD2,
	ROYAL_GUARD_T2,
	RANGER2,
	RANGER_T2,
	MECHANIC2,
	MECHANIC_T2,

	BABY_RUNE = 4096,
	BABY_WARLOCK,
	BABY_RANGER,
	BABY_BISHOP,
	BABY_MECHANIC,
	BABY_CROSS,
	BABY_GUARD,
	BABY_SORCERER,
	BABY_MINSTREL,
	BABY_WANDERER,
	BABY_SURA,
	BABY_GENETIC,
	BABY_CHASER,

	BABY_RUNE2,
	BABY_GUARD2,
	BABY_RANGER2,
	BABY_MECHANIC2,

	SUPER_NOVICE_E = 4190,
	SUPER_BABY_E,

	KAGEROU = 4211,
	OBORO,
	REBELLION = 4215,

	SUMMONER = 4218,

	MAX,
};

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

enum item_jobmask {
	NOVICE		= 1 << JOB.NOVICE,
	SWORDMAN	= 1 << JOB.SWORDMAN,
	MAGE		= 1 << JOB.MAGE,
	ARCHER		= 1 << JOB.ARCHER,
	ACOLYTE		= 1 << JOB.ACOLYTE,
	MERCHANT	= 1 << JOB.MERCHANT,
	THIEF		= 1 << JOB.THIEF,
	KNIGHT		= 1 << JOB.KNIGHT,
	PRIEST		= 1 << JOB.PRIEST,
	WIZARD		= 1 << JOB.WIZARD,
	BLACKSMITH	= 1 << JOB.BLACKSMITH,
	HUNTER		= 1 << JOB.HUNTER,
	ASSASSIN	= 1 << JOB.ASSASSIN,
	// 1<<13 free
	CRUSADER	= 1 << JOB.CRUSADER,
	MONK		= 1 << JOB.MONK,
	SAGE		= 1 << JOB.SAGE,
	ROGUE		= 1 << JOB.ROGUE,
	ALCHEMIST	= 1 << JOB.ALCHEMIST,
	BARD_DANCER	= 1 << JOB.BARD,
	// 1<<20 free
	TAEKWON		= 1 << 21,
	STARGLAD	= 1 << 22,
	SOULLINKER	= 1 << 23,
	GUNSLINGER	= 1 << JOB.GUNSLINGER,
	NINJA		= 1 << JOB.NINJA,
	BONGUN		= 1 << 26,
	DEATHKNIGHT	= 1 << 27,
	DARKCOLL	= 1 << 28,
	// 1<<29 free
	REBELLION	= 1 << 30,
	SUMMONER	= 1 << 31,
}

enum item_jobmask_rA {
	Novice    	   = 0x00000001,
	Swordman       = 0x00000002,
	Magician       = 0x00000004,
	Archer         = 0x00000008,
	Acolyte        = 0x00000010,
	Merchant       = 0x00000020,
	Thief          = 0x00000040,
	Knight         = 0x00000080,
	Priest         = 0x00000100,
	Wizard         = 0x00000200,
	Blacksmith     = 0x00000400,
	Hunter         = 0x00000800,
	Assassin       = 0x00001000,
	//Unused         = 0x00002000,
	Crusader       = 0x00004000,
	Monk           = 0x00008000,
	Sage           = 0x00010000,
	Rogue          = 0x00020000,
	Alchemist      = 0x00040000,
	BardDancer    = 0x00080000,
	//Unused         = 0x00100000,
	Taekwon        = 0x00200000,
	StarGladiator = 0x00400000,
	SoulLinker    = 0x00800000,
	Gunslinger     = 0x01000000,
	Ninja          = 0x02000000,
	Gangsi         = 0x04000000,
	DeathKnight   = 0x08000000,
	DarkCollector = 0x10000000,
	KagerouOboro  = 0x20000000,
	Rebellion      = 0x40000000,
	Summoner       = 0x80000000,
}

enum weapon_type {
	FIST,	//Bare hands
	DAGGER,	//1
	_1HSWORD,	//2
	_2HSWORD,	//3
	_1HSPEAR,	//4
	_2HSPEAR,	//5
	_1HAXE,	//6
	_2HAXE,	//7
	MACE,	//8
	_2HMACE,	//9 (unused)
	STAFF,	//10
	BOW,	//11
	KNUCKLE,	//12	
	MUSICAL,	//13
	WHIP,	//14
	BOOK,	//15
	KATAR,	//16
	REVOLVER,	//17
	RIFLE,	//18
	GATLING,	//19
	SHOTGUN,	//20
	GRENADE,	//21
	HUUMA,	//22
	_2HSTAFF,	//23
	MAX_WEAPON_TYPE,
	// dual-wield constants
	DOUBLE_DD, // 2 daggers
	DOUBLE_SS, // 2 swords
	DOUBLE_AA, // 2 axes
	DOUBLE_DS, // dagger + sword
	DOUBLE_DA, // dagger + axe
	DOUBLE_SA, // sword + axe
};

enum MD {
	CANMOVE            = 0x00001,
	LOOTER             = 0x00002,
	AGGRESSIVE         = 0x00004,
	ASSIST             = 0x00008,
	CASTSENSOR_IDLE    = 0x00010,
	BOSS               = 0x00020,
	PLANT              = 0x00040,
	CANATTACK          = 0x00080,
	DETECTOR           = 0x00100,
	CASTSENSOR_CHASE   = 0x00200,
	CHANGECHASE        = 0x00400,
	ANGRY              = 0x00800,
	CHANGETARGET_MELEE = 0x01000,
	CHANGETARGET_CHASE = 0x02000,
	TARGETWEAK         = 0x04000,
	PHYSICAL_IMMUNE    = 0x10000,
	MAGICAL_IMMUNE     = 0x20000,
}

enum RC {
	FORMLESS=0,
	UNDEAD,
	BRUTE,
	PLANT,
	INSECT,
	FISH,
	DEMON,
	DEMIHUMAN,
	ANGEL,
	DRAGON,
	BOSS,
	NONBOSS,
	NONDEMIHUMAN,
	MAX
};

enum RC_rA {
	FORMLESS = 0,
	UNDEAD,
	BRUTE,
	PLANT,
	INSECT,
	FISH,
	DEMON,
	DEMIHUMAN,
	ANGEL,
	DRAGON,
	PLAYER,
	ALL
}


enum UNIT_SIZE {
	SMALL,
	MEDIUM,
	LARGE
};

enum ELE {
	NEUTRAL=0,
	WATER,
	EARTH,
	FIRE,
	WIND,
	POISON,
	HOLY,
	DARK,
	GHOST,
	UNDEAD,
	ALL,
	NONNEUTRAL,	
	MAX
};

enum item_upper {
	normal		= 1,
	trans 		= 2,
	baby		= 4,
	third		= 8,
	transThird	= 16,
	babyThird 	= 32,
};


enum emotion_type
{
	E_GASP = 0,     // /!
	E_WHAT,         // /?
	E_HO,
	E_LV,
	E_SWT,
	E_IC,
	E_AN,
	E_AG,
	E_CASH,         // /$
	E_DOTS,         // /...
	E_SCISSORS,     // /gawi --- 10
	E_ROCK,         // /bawi
	E_PAPER,        // /bo
	E_KOREA,
	E_LV2,
	E_THX,
	E_WAH,
	E_SRY,
	E_HEH,
	E_SWT2,
	E_HMM,          // --- 20
	E_NO1,
	E_NO,           // /??
	E_OMG,
	E_OH,
	E_X,
	E_HLP,
	E_GO,
	E_SOB,
	E_GG,
	E_KIS,          // --- 30
	E_KIS2,
	E_PIF,
	E_OK,
	E_MUTE,         // red /... used for muted characters
	E_INDONESIA,
	E_BZZ,          // /bzz, /stare
	E_RICE,
	E_AWSM,         // /awsm, /cool
	E_MEH,
	E_SHY,          // --- 40
	E_PAT,          // /pat, /goodboy
	E_MP,           // /mp, /sptime
	E_SLUR,
	E_COM,          // /com, /comeon
	E_YAWN,         // /yawn, /sleepy
	E_GRAT,         // /grat, /congrats
	E_HP,           // /hp, /hptime
	E_PHILIPPINES,
	E_MALAYSIA,
	E_SINGAPORE,    // --- 50
	E_BRAZIL,
	E_FLASH,        // /fsh
	E_SPIN,         // /spin
	E_SIGH,
	E_PROUD,        // /dum
	E_LOUD,         // /crwd
	E_OHNOES,       // /desp, /otl
	E_DICE1,
	E_DICE2,
	E_DICE3,        // --- 60
	E_DICE4,
	E_DICE5,
	E_DICE6,
	E_INDIA,
	E_LOOSER,
	E_RUSSIA,
	E_VIRGIN,
	E_PHONE,
	E_MAIL,
	E_CHINESE,      // --- 70
	E_SIGNAL,
	E_SIGNAL2,
	E_SIGNAL3,
	E_HUM,
	E_ABS,
	E_OOPS,
	E_SPIT,
	E_ENE,
	E_PANIC,
	E_WHISP,        // --- 80
	//
	E_MAX
};

function getEnumMemberNameByValue(iParamVal : number, typeEnum : any) {
	for ( let member in typeEnum ) {
		let num = parseInt(member);
		if ( num == iParamVal ) {
			return typeEnum[member];
		}
	}
	return undefined;
}

function explainEnumParam(paramVal : string,  typeEnum : any) {
	let iParamVal = parseInt(paramVal);
	let paramExplanation = getEnumMemberNameByValue(iParamVal, typeEnum);

	if ( paramExplanation )
		paramVal += " ("+paramExplanation+")";

	return paramVal;
}

function explainBinMaskEnumParam(paramVal : string,  typeEnum : any) : string {
	let iParamVal = parseInt(paramVal);
	if ( iParamVal == 0xFFFFFFFF )
		return paramVal;

	let paramExplanation = "";
	for ( let member in typeEnum ) {
		let num = parseInt(member);
		if ( num & iParamVal ) {
			if ( paramExplanation )
				paramExplanation += " | ";
			paramExplanation += typeEnum[member];
		}
	}

	if ( paramExplanation )
		paramVal += " ("+paramExplanation+")";


	return paramVal;
}


function explainItemIdParam(paramVal : string, full : boolean, html : boolean) : string {
	let iParamVal = parseInt(paramVal);
	if ( iParamVal < 1 )
		return paramVal;
	
	let itemDbLine = itemDB.idToDbLine.get(parseInt(paramVal));
	if ( itemDbLine ) {
		if ( !full ) {
			if ( itemDbParamIndex.AegisName < itemDbLine.params.length )
				paramVal += " " + itemDbLine.params[itemDbParamIndex.AegisName];
			let imageURL = itemImageURL ? itemImageURL.replace("ITEMID", iParamVal.toString()) : iParamVal.toString();
			if ( html )
				paramVal = "<img src=\""+ imageURL +"\">"+ paramVal;
			else
				paramVal = makeMarkdownLinkWithImage(itemDbLine, imageURL, 18, 18) + " " + paramVal;
		} else {
			if ( html )
				paramVal += "<br><br>ItemDB<br>";
			else
				paramVal += "   \n___  \n";
			paramVal += itemDB.explainLine(itemDbLine, html);
		}
	}
	return paramVal;
}

function isFullyNumericString(str : string) : boolean
{
	let i = parseInt(str);
	return i.toString() == str;
}

function explainSkillIdOrTechNameParam(paramVal : string, html : boolean) {
	let dbLine;
	let appendTechName = false;
	if ( isFullyNumericString(paramVal) ) {
		dbLine = skillDB.idToDbLine.get(parseInt(paramVal));
		appendTechName = true;
	} else {
		dbLine = skillDB.nameToDbLine.get(paramVal);
	}
	if ( !dbLine )
		return paramVal;

	let skillId = dbLine.getParamByIndex(skillDB.keyIndex);
	let techName = dbLine.getParamByIndex(skillDB.nameIndex);
	if ( !techName || !skillId )
		return paramVal;

	let url = skillImageURL ? skillImageURL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", techName.toLowerCase().toString()) : "";
	let ret;
	if ( html )
		ret = "<img src=\""+url+"\">" + paramVal;
	else
		ret = makeMarkdownLinkWithImage(dbLine, url, 18, 18) + " " + paramVal;
	if ( appendTechName )
		ret += " (" + dbLine.getParamByIndex(skillDB.nameIndex) + ")";
	return ret;	
}


function loadConstDB(filePath : string, hppFilePath? : string) {
	if ( !fs.existsSync(filePath) )
		throw new Error("AthenaConstDB: " + filePath + " not exists");
	let fileContent = fs.readFileSync(filePath);
	let lines : string[];
	lines = fileContent.toString().split(/\r?\n/);
	lines.forEach(l => {
		l = l.trim();
		if ( l.startsWith("//") )
			return;

		let tokens = l.split("\t");
		if ( tokens.length < 2 )
			return;
		constDB.set(tokens[0].toLowerCase(), new AthenaConst(tokens[0], parseInt(tokens[1])));
	});

	if ( hppFilePath ) {
		let fileContentStr : string = fs.readFileSync(hppFilePath).toString();
		fileContentStr.split("\n").forEach(line => {
			let startCommentIdx = line.indexOf("//");
			if ( startCommentIdx >= 0)
				line = line.substring(0,startCommentIdx);
			if ( line.includes("#define") )
				return;

			let match = 
			    line.match(/export_parameter\("([^"]*)",[ ]*([^\)]*)\);/)
			|| line.match(/export_(?:deprecated_)?constant\(([^\)]*)\);/) 
			|| line.match(/export_(?:deprecated_)?constant_npc\(JT_([^\)]*)\);/) 
			|| line.match(/export_(?:deprecated_)?constant2\("([^"]*)",[ ]*([^\)]*)\);/)
			 || line.match(/export_deprecated_constant3\("([^"]*)",[ ]*([^,]*),[ ]*"([^\)]*)\);/)

			if ( !match ) 
				return;
			let name : string;
			let val : string;

			if ( match.length >= 4 ) {	// export_deprecated_constant3
				name = match[1];
				val = match[2];
				// pleaseChangeTo = match[3];
			} else if ( match.length >= 3 ) {
				name = match[1];
				val = match[2];
			} else if ( match.length >= 2) {
				name = match[1];
				val = match[1];
			} else
				return;

			constDB.set(name.toLowerCase(), new AthenaConst(name, isFullyNumericString(val) ? parseInt(val) : undefined));
		});
	}
}	


class ItemDBParamIndex {
	n = 0;
	readonly ID = this.n++;
	readonly AegisName = this.n++;
	readonly Name = this.n++;
	readonly RusName = is_rAthena ? undefined : this.n++;
	readonly Type = this.n++;
	readonly Buy = this.n++;
	readonly Sell = this.n++;
	readonly Weight = this.n++;
	readonly ATK = this.n++;
	readonly MATK = is_rAthena ? undefined : this.n++;
	readonly DEF = this.n++;
	readonly Range = this.n++;
	readonly Slots = this.n++;
	readonly Job = this.n++;
	readonly Upper = this.n++;
	readonly Gender = this.n++;
	readonly Loc = this.n++;
	readonly wLV = this.n++;
	readonly eLV = this.n++;
	readonly Refineable = this.n++;
	readonly View = this.n++;
	readonly Script = this.n++;
	readonly OnEquip_Script = this.n++;
	readonly OnUnequip_Script = this.n++;

	visibleName() : number {
		return (!is_rAthena && this.RusName !== undefined ) ? this.RusName : this.Name;
	}
}
let itemDbParamIndex : ItemDBParamIndex;

class AthenaItemDB extends AthenaDB {
	constructor(filePaths : string[]) {
		super(filePaths);
	}

	explainParamByLine(line : AthenaDBLine, paramIdx : number, html : boolean) {
		let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";

		switch ( paramIdx ) {
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
				if ( line.getIntParamByIndex(itemDbParamIndex.Type) == getITEnumType().WEAPON )
					paramVal = explainEnumParam(paramVal, weapon_type);
				break;
			case itemDbParamIndex.Upper:
				paramVal = explainBinMaskEnumParam(paramVal, item_upper);
				break;
			case itemDbParamIndex.Script:
			case itemDbParamIndex.OnEquip_Script:
			case itemDbParamIndex.OnUnequip_Script:
				let formattedScript = this.formatScript(paramVal);
				if ( html )
					paramVal = "<pre>" + formattedScript.replace(/\n/g, "<br>") + "</pre>";
				else
					paramVal = new vscode.MarkdownString().appendCodeblock(formattedScript, languageIdLowerCase).value;	// languageId eAthena with capital "A" doesn't work in this case for some reason
				break;
		}

		return super.explainParamByLineSub(line, paramIdx, paramVal, html);
	}

	getParamDocumentation(paramIdx : number) : string|undefined {
		switch ( paramIdx ) {
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


	getSymbolLabelForLine(l : AthenaDBLine) : string|undefined {
		let id = l.getParamByIndex(itemDbParamIndex.ID);
		let aegisName = l.getParamByIndex(itemDbParamIndex.AegisName);
		let engName = l.getParamByIndex(itemDbParamIndex.Name);
		let rusName = itemDbParamIndex.RusName ? l.getParamByIndex(itemDbParamIndex.RusName) : undefined;

		if ( !id || !aegisName || !engName)
			return undefined;
		let ret = id + ":" + aegisName + ":" + engName;
		if ( rusName )
			ret += ":" + rusName;
		return ret;
	}

	explainLine(line: AthenaDBLine, html : boolean, cursorPosition? : vscode.Position) : string {
		let ret = super.explainLine(line, html, cursorPosition);
		let itemId = line.getIntParamByIndex(itemDbParamIndex.ID);
		if ( itemId ) {
			let itemTradeLine = itemTradeDB.idToDbLine.get(itemId);
			if ( itemTradeLine ) {
				let tradeRestrictions = itemTradeDB.explainParamByLine(itemTradeLine, AthenaItemTradeDBColumns.TradeMask, html);
				if ( tradeRestrictions )
					ret += (html ? "<br>" : "  \n") + tradeRestrictions;
			}
		}

		return ret;
	}

	formatScript(script : string) : string {
		if ( script.startsWith("{") && script.endsWith("}") )
			script = script.substring(1, script.length-1);

		let formattedScript = "";
		let indent = 0;

		let i = 0;
		// skip whitespace at start
		for ( i = 0; i < script.length; i++ )
			if (!isWhitespace(script.charAt(i)))
				break;

		for ( ; i < script.length; i++ ) {
			let c = script.charAt(i);
			
			if ( c == "{" ) {
				indent++;
				formattedScript += "{\n" + "\t".repeat(indent);
				// skip whitespace
				i++;
				for ( ; i < script.length; i++ )
					if ( !isWhitespace(script.charAt(i)) )
						break;
				i--;
			} else if ( c == "}" ) {
				indent--;
				if ( indent < 0 )
					indent = 0;
				if ( formattedScript.charAt(formattedScript.length-1) == "\t" )
					formattedScript = formattedScript.substr(0, formattedScript.length-1); // crop last tab to reduce indent
				formattedScript += "}" + "\n" + "\t".repeat(indent);
				// skip whitespace
				i++;
				for ( ; i < script.length; i++ )
					if ( !isWhitespace(script.charAt(i)) )
						break;
				i--;
			} else if ( c == ";" ) {
				formattedScript += ";\n" + "\t".repeat(indent);
				// skip whitespace
				i++;
				for ( ; i < script.length; i++ )
					if ( !isWhitespace(script.charAt(i)) )
						break;
				i--;
			} else if ( c == "\"" ) {
				formattedScript += c;
				i++;
				for ( ; i < script.length; i++ ) {
					formattedScript += script.charAt(i);
					if ( script.charAt(i) == "\"" && script.charAt(i-1) != "\\" )
						break;
				}
			} else {
				formattedScript += c;
			}
		}

		formattedScript = formattedScript.trim();

		return formattedScript;
	}
}

class MobDBParamIndex {
	n = 0;

	readonly ID = this.n++;
	readonly Sprite_Name = this.n++;
	readonly kROName = this.n++;
	readonly iROName = this.n++;
	readonly RusName = is_rAthena ? undefined : this.n++;
	readonly LV = this.n++;
	readonly HP = this.n++;
	readonly SP = this.n++;
	readonly EXP = this.n++;
	readonly JEXP = this.n++;
	readonly Range1 = this.n++;
	readonly ATK1 = this.n++;
	readonly ATK2 = this.n++;
	readonly DEF = this.n++;
	readonly MDEF = this.n++;
	readonly STR = this.n++;
	readonly AGI = this.n++;
	readonly VIT = this.n++;
	readonly INT = this.n++;
	readonly DEX = this.n++;
	readonly LUK = this.n++;
	readonly Range2 = this.n++;
	readonly Range3 = this.n++;
	readonly Scale = this.n++;
	readonly Race = this.n++;
	readonly Element = this.n++;
	readonly Mode = this.n++;
	readonly Speed = this.n++;
	readonly aDelay = this.n++;
	readonly aMotion = this.n++;
	readonly dMotion = this.n++;
	readonly MEXP = this.n++;
	readonly MVP1id = this.n++;
	readonly MVP1per = this.n++;
	readonly MVP2id = this.n++;
	readonly MVP2per = this.n++;
	readonly MVP3id = this.n++;
	readonly MVP3per = this.n++;
	readonly Drop1id = this.n++;
	readonly Drop1per = this.n++;
	readonly Drop2id = this.n++;
	readonly Drop2per = this.n++;
	readonly Drop3id = this.n++;
	readonly Drop3per = this.n++;
	readonly Drop4id = this.n++;
	readonly Drop4per = this.n++;
	readonly Drop5id = this.n++;
	readonly Drop5per = this.n++;
	readonly Drop6id = this.n++;
	readonly Drop6per = this.n++;
	readonly Drop7id = this.n++;
	readonly Drop7per = this.n++;
	readonly Drop8id = this.n++;
	readonly Drop8per = this.n++;
	readonly Drop9id = this.n++;
	readonly Drop9per = this.n++;
	readonly DropCardid = this.n++;
	readonly DropCardper = this.n++;

	visibleName() {
		return ( !is_rAthena && this.RusName !== undefined ) ? this.RusName : this.kROName;
	}
}

let mobDbParamIndex : MobDBParamIndex;


class AthenaMobDB extends AthenaDB {

	constructor(filePaths : string[]) {
		super(filePaths, undefined, mobDbParamIndex.ID);
	}

	explainParamByLine(line : AthenaDBLine, paramIdx : number, html : boolean) : string {
		//let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
		let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";

	
		if ( paramIdx == mobDbParamIndex.ID ) {
			let iParamVal = parseInt(paramVal);
			if ( iParamVal > 0 ) {
				let mobDbLine = mobDB.idToDbLine.get(parseInt(paramVal));
				if ( mobDbLine ) {
					if ( mobDbParamIndex.Sprite_Name < mobDbLine.params.length )
						paramVal += " (" + mobDbLine.params[mobDbParamIndex.Sprite_Name] + ")";
					let url = mobImageURL ? mobImageURL.replace("MOBID", iParamVal.toString()) : "";
					if ( html )
						paramVal = "<img src=\""+ url +"\">" + paramVal;
					else
						paramVal = makeMarkdownLinkWithImage(mobDbLine, url, 32, 32) + " " + paramVal;
				}
			}
		} else if ( paramIdx == mobDbParamIndex.Mode )
			paramVal = explainBinMaskEnumParam(paramVal, MD);
		else if ( paramIdx == mobDbParamIndex.Element ) {
			let iParamVal = parseInt(paramVal);
			let eleLv = Math.floor(iParamVal / 20);
			let eleNum = iParamVal % 10;
			let paramExplanation = getEnumMemberNameByValue(eleNum, ELE);
			if ( paramExplanation )
				paramVal += " (" + paramExplanation + " "+ eleLv +")";
		}
		else if ( paramIdx == mobDbParamIndex.Race )
			paramVal = explainEnumParam(paramVal, is_rAthena ? RC_rA : RC);
		else if ( paramIdx == mobDbParamIndex.Scale )
			paramVal = explainEnumParam(paramVal, UNIT_SIZE);
		else if (  paramIdx == mobDbParamIndex.Drop1id
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
				|| paramIdx == mobDbParamIndex.MVP3id ) 
		{
			paramVal = explainItemIdParam(paramVal, !this.alreadyExplainingLine, html);
		} else if (  paramIdx == mobDbParamIndex.Drop1per
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
				  || paramIdx == mobDbParamIndex.MVP3per )
		{
			let iVal = parseInt(paramVal);
			let iValDiv = iVal / 100;
			paramVal = iValDiv + "%"; 
		}
		
		return super.explainParamByLineSub(line, paramIdx, paramVal, html);
	}

	getParamDocumentation(paramIdx : number) : string|undefined {
		//let paramName = this.paramNames[paramIdx];
		if ( paramIdx == mobDbParamIndex.Mode )
			return this.enumToParamDocumentation(MD, 1);
		else if ( paramIdx == mobDbParamIndex.Element )
			return "ElementLv: value / 20  \nElementType: value % 10  \nTypes:  \n" + this.enumToParamDocumentation(ELE, 0);
		else if ( paramIdx == mobDbParamIndex.Race )
			return this.enumToParamDocumentation(is_rAthena ? RC_rA : RC, 0);
		else if ( paramIdx == mobDbParamIndex.Scale )
			return this.enumToParamDocumentation(UNIT_SIZE, 0);
	
		return undefined;
	}

	getSymbolLabelForLine(l : AthenaDBLine) : string|undefined {
		let id = l.getParamByIndex(mobDbParamIndex.ID);
		let spriteName = l.getParamByIndex(mobDbParamIndex.Sprite_Name);
		let kROName = l.getParamByIndex(mobDbParamIndex.kROName);

		if ( !id || !spriteName || !kROName )
			return undefined;

		let rusName = mobDbParamIndex.RusName ? l.getParamByIndex(mobDbParamIndex.RusName) : undefined;
		let ret = id + ":" + spriteName + ":" + kROName;
		if ( rusName )
			ret += ":" + rusName;
		return ret;
	}

	explainLine(line: AthenaDBLine, html : boolean, cursorPosition? : vscode.Position): string {
		let addExplanation = "";
		let mobIdStr = line.getParamByIndex(this.keyIndex);
		if ( mobIdStr ) {
			let mobId = parseInt(mobIdStr);
			if ( mobId > 0 && mobSkillDB.mobidToSkillList ) {
				let mobSkills = mobSkillDB.mobidToSkillList.get(mobId);
				if ( mobSkills && mobSkills.length > 0 ) {
					mobSkills.forEach(l => {
						let skillId = l.getParamByIndex(mobSkillDBParamIndex.skillId);
						if ( skillId ) {
							let skillIdExplanation = explainSkillIdOrTechNameParam(skillId, html);
							let mobSkillDbLineShort = mobSkillDB.explainLineShort(l);

							if ( html )
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

	static possibleTargets = [
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
		["around",  "same as around4 (9x9 around self)"],
	];

	static possibleStates = [
		[ "any", "All states except Dead" ],
		[ "idle" ],
		[ "walk" ],
		[ "loot" ],
		[ "dead", "when killed" ],
		[ "angry",  "attack before being damaged" ],
		[ "attack", "attack after being damaged" ],
		[ "follow", "chase before being damaged" ],
		[ "chase",  "chase after being damaged" ],
		[ "anytarget", "Berserk+Angry+Rush+Follow" ]
	];

	static possibleConditions = [
		[ "always",				"unconditional" ],
		[ "onspawn",			"when the mob spawns/respawns." ],
		[ "myhplemaxrate",		"when the mob's hp drops to a certain %, inclusive" ],
		[ "myhpinrate",			"when the mob's hp is in a certain % range ('a condition value' is the lower cap, while 'a value 1' is the upper cap, inclusive)." ],
		[ "mystatuson",			"If the mob has any abnormalities in status (condition value)" ],
		[ "mystatusoff",		"If the mob has ended any abnormalities in status (condition value)" ],
		[ "friendhplemaxrate",	"when the mob's friend's hp drops to a certain %, inclusive" ],
		[ "friendhpinrate",		"when the mob's friend's hp is in a certain % range (range defined the same way as in myhpinrate)" ],
		[ "friendstatuson",		"If the friend has any abnormalities in status (condition value)" ],
		[ "friendstatusoff",	"If the friend has ended any abnormalities in status (condition value)" ],
		[ "attackpcgt",			"Attack PC becomes more than the  number of specification" ],
		[ "attackpcge",			"Attack PC becomes equal or more than the number of specification." ],
		[ "slavelt",			"when the number of slaves is lower than the original number of specification." ],
		[ "slavele",			"when the number of slaves is lower or equal than the original number of specification." ],
		[ "closedattacked",		"when melee attacked (close range attack)" ],
		[ "longrangeattacked",	"when long ranged attacked (like bows and far range weapons)" ],
		[ "skillused",			"when a skill is used on the mob" ],
		[ "afterskill",			"after the mob used certain skill." ],
		[ "casttargeted",		"when a target is in cast range." ],
		[ "rudeattacked",		"when a target is rude attacked" ],
	];

	mobidToSkillList? : Map<number, Array<AthenaDBLine>>;

	constructor(fileNames : string[]) {
		super(fileNames, undefined, 999, 999);
	}

	explainParamByLine(line: AthenaDBLine, paramIdx: number, html : boolean): string {
		//MOB_ID,dummy value (info only),STATE,SKILL_ID,SKILL_LV,rate (10000 = 100%),casttime,delay,cancelable,target,condition type,condition value,val1,val2,val3,val4,val5,emotion,chat{,increaseRange,castbegin_script,castend_script}
		let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
		let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";

		if ( paramName == "MOB_ID" ) {
			let iVal = parseInt(paramVal);
			if ( iVal > 0 ) {
				let mobDbLine = mobDB.idToDbLine.get(iVal);
				if ( mobDbLine )
					paramVal += "   \n___  \n" + mobDB.explainLine(mobDbLine, html);
			}
		} else if ( paramName == "SKILL_ID" ) {
			paramVal = explainSkillIdOrTechNameParam(paramVal, html);
		} else if ( paramName == "rate (10000 = 100%)" ) {
			paramVal = parseInt(paramVal) / 100 + " %";
		} else if ( paramName == "casttime" || paramName == "delay" )
			paramVal = millisecondsToHumanReadableString(parseInt(paramVal));
		else if ( paramName == "dummy value (info only)" ) {
			if ( !this.alreadyExplainingLine ) {
				paramVal = this.explainLine(line, html);
			}
		}
		else if ( paramName == "target" )
			paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleTargets);
		else if ( paramName == "STATE" )
			paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleStates);
		else if ( paramName == "condition type" )
			paramVal = this.getExplanationByArray(paramVal, AthenaMobSkillDB.possibleConditions);
		else if ( paramName == "condition value" ) {
			let condTypeParamIdx = this.getParamIndex("condition type");
			if ( condTypeParamIdx !== undefined ) {
				let condTypeVal = line.getParamByIndex(condTypeParamIdx);
				if ( condTypeVal == "skillused" || condTypeVal == "afterskill" )
					paramVal = explainSkillIdOrTechNameParam(paramVal, html);
			}
		} else if ( paramName == "emotion" )
			paramVal = explainEnumParam(paramVal, emotion_type);
		return this.explainParamByLineSub(line, paramIdx, paramVal, html);
	}

	getExplanationByArray(paramVal : string, array : Array<string[]>) : string {

		for ( let i = 0; i < array.length; i++ ) {
			let t = array[i];
			if ( paramVal == t[0] && t.length > 1 ) {
				paramVal += " : " + t[1];
				break;
			}
		}
		return paramVal;
	}

	getDocumentationByArray(array : Array<string[]>) : string {
		let ret = "";
		array.forEach(t => {
			ret += "  \n" + t[0];
			if ( t.length > 1 )
				ret += " : " + t[1];
		});
		return ret;
	}


	getParamDocumentation(paramIdx: number) : string|undefined {
		let paramName = this.paramNames[paramIdx];

		if ( paramName == "target" ) {
			return this.getDocumentationByArray(AthenaMobSkillDB.possibleTargets);
		} else if ( paramName == "STATE" ) {
			return this.getDocumentationByArray(AthenaMobSkillDB.possibleStates);
		} else if ( paramName == "condition type" )
			return this.getDocumentationByArray(AthenaMobSkillDB.possibleConditions);
	}

	// Need a custom index rebuild function to support multiple skills per mob
	rebuildIndex() {
		let mobIdIndex = 0;

		this.mobidToSkillList = new Map<number, Array<AthenaDBLine>>();

		this.files.forEach(f => {
			f.lines.forEach(l => {
				if ( mobIdIndex >= l.params.length )
					return;

				let mobId = parseInt(l.params[mobIdIndex]);
				if ( mobId < 1 || !this.mobidToSkillList )
					return;
				let mobSkills = this.mobidToSkillList.get(mobId);
				if ( !mobSkills )
					mobSkills = new Array<AthenaDBLine>();
				mobSkills.push(l);
				this.mobidToSkillList.set(mobId, mobSkills);
			});
		});
	}



	explainLineShort(dbLine : AthenaDBLine) : string
	{
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
			+ ( rate ? rate / 100.0 : 0 ) + "% " 
			+ state + " "
			+ (casttime ? "ct:" + millisecondsToHumanReadableString(casttime) + " " : "" )
			+ (delay ? "cd:" + millisecondsToHumanReadableString(delay) + " " : "" )
			+ target + " "
			+ condtype + " "
			+ condVal + " "
			+ (val1||"") + " "
			+ (val2||"") + " "
			+ (val3||"") + " "
			+ (val4||"") + " "
			+ (val5||"");
	}
	
}
class MobSkillDBParamIndex {
	n = 0;
	readonly mobId = this.n++;
	readonly dummyName = this.n++;
	readonly state = this.n++;
	readonly skillId = this.n++;
	readonly skillLv = this.n++;
	readonly rate = this.n++;
	readonly casttime = this.n++;
	readonly delay = this.n++;
	readonly cancelable = this.n++;
	readonly target = this.n++;
	readonly conditionType = this.n++;
	readonly conditionValue = this.n++;
	readonly val1 = this.n++;
	readonly val2 = this.n++;
	readonly val3 = this.n++;
	readonly val4 = this.n++;
	readonly val5 = this.n++;
	readonly emotion = this.n++;
	readonly chat = is_rAthena ? undefined : this.n++;
	readonly increaseRange = is_rAthena ? undefined : this.n++;
	readonly castBeginScript = is_rAthena ? undefined : this.n++;
	readonly castEndScript = is_rAthena ? undefined : this.n++;

	constructor() {}
}

let mobSkillDBParamIndex : MobSkillDBParamIndex;

enum INF
{
	ATTACK_SKILL  = 0x01,
	GROUND_SKILL  = 0x02,
	SELF_SKILL    = 0x04, // Skills casted on self where target is automatically chosen
	// 0x08 not assigned
	SUPPORT_SKILL = 0x10,
	TARGET_TRAP   = 0x20,
};

enum NK
{
	NO_DAMAGE         = 0x01,  // Is a no-damage skill
	SPLASH            = 0x02|0x04, // 0x4 = splash & split
	SPLASHSPLIT       = 0x04,  // Damage should be split among targets
	NO_CARDFIX_ATK    = 0x08,  // Skill ignores caster's % damage cards (misc type always ignores)
	NO_ELEFIX         = 0x10,  // Skill ignores elemental adjustments
	IGNORE_DEF        = 0x20,  // Skill ignores target's defense (misc type always ignores)
	IGNORE_FLEE       = 0x40,  // Skill ignores target's flee (magic type always ignores)
	NO_CARDFIX_DEF    = 0x80,  // Skill ignores target's def cards
};

enum INF2
{
	QUEST_SKILL    = 0x00001,
	NPC_SKILL      = 0x00002, //NPC skills are those that players can't have in their skill tree.
	WEDDING_SKILL  = 0x00004,
	SPIRIT_SKILL   = 0x00008,
	GUILD_SKILL    = 0x00010,
	SONG_DANCE     = 0x00020,
	ENSEMBLE_SKILL = 0x00040,
	TRAP           = 0x00080,
	TARGET_SELF    = 0x00100, //Refers to ground placed skills that will target the caster as well (like Grandcross)
	NO_TARGET_SELF = 0x00200,
	PARTY_ONLY     = 0x00400,
	GUILD_ONLY     = 0x00800,
	NO_ENEMY       = 0x01000,
	CHORUS_SKILL   = 0x02000,
	NO_NEUTRAL		= 0x04000, // disable usage on neutrals (for buffs with a harmful side-effect)
	HOMUN_SKILL    = 0x08000,
	ELEMENTAL_SKILL= 0x10000,
	MERC_SKILL		= 0x20000,
	SHOW_SCALE     = 0x40000,
};


class SkillDBParamIndex {
	n = 0;

    readonly id = this.n++;
	readonly range = this.n++;
	readonly hit = this.n++;
	readonly inf = this.n++;
	readonly element = this.n++;
	readonly nk = this.n++;
	readonly splash = this.n++;
	readonly max = this.n++;
	readonly numberOfHits = this.n++;
	readonly castCancel = this.n++;
	readonly castDefenseRate = this.n++;
	readonly inf2 = this.n++;
	readonly maxCount = this.n++;
	readonly skillType = this.n++;
	readonly blowCount = this.n++;
	readonly inf3 = is_rAthena ? this.n++ : undefined;
	readonly techName = this.n++;
	readonly visibleName = this.n++;
	readonly rusName = !is_rAthena ? this.n++ : undefined;

	defaultVisibleName() : number {
		return (!is_rAthena && this.rusName !== undefined) ? this.rusName : this.visibleName;
	}
}

let skillDbParamIndex : SkillDBParamIndex;

class AthenaSkillDB extends AthenaDB {


	constructor(fileName? : string) {
		super(fileName ? [fileName] : [athenaDbDir + "/skill_db.txt"], undefined, 0, skillDbParamIndex.techName);
	}

	explainParamByLine(line : AthenaDBLine, paramIdx : number, html : boolean) : string {
		let paramName = paramIdx < this.paramNames.length ? this.paramNames[paramIdx] : "?";
		let paramVal = paramIdx < line.params.length ? line.params[paramIdx].trim() : "";
		if ( paramName == "name" || paramName == "id" ) {
			paramVal = explainSkillIdOrTechNameParam(paramVal, html);
		}
		else if ( paramName == "range" ) {
			let iVal = parseInt(paramVal);
			if ( iVal < 5 )
				paramVal += " (melee)";
			else
				paramVal += " (ranged)";
		} 
		else if ( paramName == "hit" ) {
			let iVal = parseInt(paramVal);
			if ( iVal == 8 )
				paramVal += " (repeated hitting)";
			else if ( iVal == 6 )
				paramVal += " (single hit)";
		} 
		else if ( paramName == "inf" ) 
			paramVal = explainBinMaskEnumParam(paramVal, INF);
		else if ( paramName == "element" ) {
			let iVal = parseInt(paramVal);
			if ( iVal == -1 )
				paramVal += " (weapon)";
			else if ( iVal == -2 )
				paramVal += " (endowed)";
			else if ( iVal == -3 )
				paramVal += " (random)";
			else
				paramVal = explainEnumParam(paramVal, ELE);
		}
		else if ( paramName == "nk" )
			paramVal = explainBinMaskEnumParam(paramVal, NK);
		else if ( paramName == "splash" ) {
			let iVal = parseInt(paramVal);
			if ( iVal == -1 ) 
				paramVal += " (fullscreen)";
		}
		else if ( paramName == "number_of_hits" ) {
			let iVal = parseInt(paramVal);
			if ( iVal < 0 )
				paramVal = "/" + (-iVal);
			else if ( iVal > 0 )
				paramVal = "x" + iVal;
		}
		else if ( paramName == "inf2" )
			paramVal = explainBinMaskEnumParam(paramVal, INF2);

		return this.explainParamByLineSub(line, paramIdx, paramVal, html);
	}

	
	getParamDocumentation(paramIdx : number) : string | undefined {
		let paramName = this.paramNames[paramIdx];
		if ( paramName == "inf" )
			return this.enumToParamDocumentation(INF, 1);
		else if ( paramName == "nk" )
			return this.enumToParamDocumentation(NK, 1);
		else if ( paramName == "inf2" )
			return this.enumToParamDocumentation(INF2, 1);
		else if ( paramName == "element")
			return this.enumToParamDocumentation(ELE, 0);
	}

	explainLine(line : AthenaDBLine, html : boolean, cursorPosition? : vscode.Position) : string {
		let result = super.explainLine(line, html, cursorPosition);
		let skillId = parseInt(line.params[this.keyIndex]);
		if ( skillId < 1 )
			return result;
		let skillCastDbLine = skillCastDB.idToDbLine.get(skillId);
		if ( !skillCastDbLine )
			return result;

		let skillCastDbExplanation = skillCastDB.explainLine(skillCastDbLine, html);

		if ( html )
			result = "Skill DB<br>" + result + "<br>Skill Cast DB<br>" + skillCastDbExplanation;
		else
			result = result + "   \n___  \n" + skillCastDbExplanation;
		return result;
	}


	getSymbolLabelForLine(l : AthenaDBLine) : string|undefined {
		let skillId = l.getParamByIndex(skillDbParamIndex.id);
		let techName = l.getParamByIndex(skillDbParamIndex.techName);
		let visibleName = l.getParamByIndex(skillDbParamIndex.visibleName);
		if ( skillDbParamIndex )

		if ( !skillId || !techName || !visibleName )
			return undefined;

		let ret = skillId + ":" + techName + ":" + visibleName;
		if ( skillDbParamIndex.rusName !== undefined )
			ret += ":" + l.getParamByIndex(skillDbParamIndex.rusName);
		return ret;
	}

}


class AthenaSkillCastDB extends AthenaDB {
	constructor(fileName? : string) {
		super(fileName ? [fileName] : [athenaDbDir + "/skill_cast_db.txt"], undefined, undefined, 8);
	}
}

class ItemBonusDB_rAthena_Entry {
	argCount : number;
	name : string;
	params : string;
	desc : string;

	constructor(argCount : number, name : string, params : string, desc : string) {
		this.argCount = argCount;
		this.name = name;
		this.params = params;
		this.desc = desc;
	}
}

class ItemBonusDB_rAthena {
	list : ItemBonusDB_rAthena_Entry[];

	constructor(filePath : string) {
		let fileContentBytes = fs.readFileSync(filePath);
		let fileContent : string = iconv.decode(fileContentBytes, codepage);
		let lines = fileContent.split("\n");

		this.list = new Array<ItemBonusDB_rAthena_Entry>();

		lines.forEach(line => {
			let match = line.match(/bonus([0-9]*) ([^,;]*)[,]*([^;]*);[ \t]*([^\n]*)/);
			if ( match && match.length >= 3) {
				let argCount = parseInt(match[1]);
				let name = match[2];
				let params = match[3];
				let desc = match[4];
				this.list.push(new ItemBonusDB_rAthena_Entry(argCount, name, params, desc));
			}
		});
	}

	explainBonus(word : string) : string|undefined {
		let str = "";
		this.list.forEach(b => {
			if ( b.name.toLowerCase() == word.toLowerCase() )
				str += "**bonus" + ( b.argCount > 0 ? b.argCount : "" ) + " " + b.name + "," + b.params + ";  \n" + b.desc;
		});

		if ( str == "" )
			return undefined;
		else
			return str;
	}
}

class ItemBonusDB extends AthenaDB {
	static argCountCol = 0;
	static bonusNameCol = 1;
	static bonusFormatCol = 2;

	constructor(filePaths : Array<string>)
	{
		super(filePaths, "argCount,bonusName,bonusFormat");
	}

	searchBonus(bonusName : string) : Array<AthenaDBLine> {
		let ret = Array<AthenaDBLine>();
		this.files.forEach(file => {
			file.lines.forEach(line => {
				if ( line.params.length >= 3 && line.params[ItemBonusDB.bonusNameCol] == bonusName )
					ret.push(line);
			});
		});
		return ret;
	}

	explainBonus(word : string) : string|undefined
	{
		let itemBonusDbLines = this.searchBonus(word);
		if ( itemBonusDbLines.length > 0 ) {
			let str = "";
			itemBonusDbLines.forEach(bonus => {
				str += "**bonus" + ( parseInt(bonus.params[ItemBonusDB.argCountCol]) > 1 ? bonus.params[ItemBonusDB.argCountCol] : "" ) + " " + bonus.params[ItemBonusDB.bonusNameCol] + "** " + bonus.params[ItemBonusDB.bonusFormatCol] + "  \n";
			});
			return str;
			//return new vscode.Hover(str, wordRange);
		}
		return undefined;
	}
}

class AthenaQuestDBFile extends AthenaDBFile {
	createLine(filePath : string, lineNum : number, line : string) : AthenaDBLine {
		return new AthenaQuestDBLine(filePath, lineNum, line); 
	}
}

class AthenaQuestDB extends AthenaDB {
	createFile(db : AthenaDB, filePath : string) {
		return new AthenaQuestDBFile(db, filePath);
	}
}


function millisecondsToHumanReadableString(milliseconds : number)
{
	let timeStr = "";
	let days = Math.floor(milliseconds / (3600 * 24 * 1000));
	let hours = Math.floor(milliseconds % (3600 * 24 * 1000) / (3600 * 1000) );
	let minutes = Math.floor(milliseconds % (3600 * 1000) / (60 * 1000) );
	let secondsAndMillis = milliseconds % (60 * 1000);

	if ( days )
		timeStr += " " + days + "d";
	if ( hours ) {
		// if ( timeStr.length > 0 )
		// 	timeStr += " "
		timeStr += hours + "h";
	}
	if ( minutes ) {
		// if ( timeStr.length > 0 )
		// 	timeStr += " "
		timeStr += minutes + "m";
	}
	if ( secondsAndMillis ) {
		// if ( timeStr.length > 0 )
		// 	timeStr += " "
		timeStr += ( secondsAndMillis / 1000 ) + "s";
	}

	return timeStr;
}

class AthenaQuestDBLine extends AthenaDBLine {
	QuestID!: number;
	// line!:string;
	// lineNum!:number;

	Time!:string;
	MobId:Array<number> = new Array<number>(3);
	MobCount:Array<number> = new Array<number>(3);
	DropItemMobId:Array<number> = new Array<number>(3);
	DropItemId:Array<number> = new Array<number>(3);
	DropItemRate:Array<number> = new Array<number>(3);
	QuestLabel!:string;
	

	constructor(filePath: string, lineNum: number, line: string)
	{
		super(filePath, lineNum, line);

		let n = 0;
		let tokens = this.params;

		for ( let i = 0; i < tokens.length; i++ )
			tokens[i] = tokens[i].trim();

		this.QuestID = parseInt(tokens[n++]);
		this.Time = tokens[n++];
		for ( let i = 0; i < this.MobId.length; i++ ) {
			this.MobId[i] = parseInt(tokens[n++]);
			this.MobCount[i] = parseInt(tokens[n++]);
		}
		if ( tokens.length > 9 ) {
			for ( let i = 0; i < this.DropItemId.length; i++ ) {
				this.DropItemMobId[i] = parseInt(tokens[n++]);
				this.DropItemId[i] = parseInt(tokens[n++]);
				this.DropItemRate[i] = parseInt(tokens[n++]);
			}
		}
		this.QuestLabel = tokens[n++];
	}



	getStringForTooltip() : string
	{
		let str = makeMarkdownLink(this.lineStr, serverQuestDbPath, this.lineNum) + "  \n"; 
		if ( this.Time.indexOf(":") == -1 ) {
			let timeStr : string = "";
			let timeNum : number = parseInt(this.Time);
			if ( timeNum ) {
				let days = Math.floor(timeNum / (3600 * 24));
				let hours = Math.floor(timeNum % (3600 * 24) / 3600);
				let minutes = Math.floor(timeNum % 3600 / 60);
				let seconds = Math.floor(timeNum % 60);
	
				if ( days )
					timeStr += " " + days + "d";
				if ( hours )
					timeStr += " " + hours + "h";
				if ( minutes )
					timeStr += " " + minutes + "m";
				if ( seconds )
					timeStr += " " + seconds + "s";
				str += "*Cooldown:* " + timeStr + " ("+this.Time+")  \n";
			}
		}
		for ( let i = 0; i < this.MobId.length; i++ ) {
			if ( this.MobId[i] )
				str += ""+ (i+1) + ". hunt *" + mobDB.tryGetParamOfLineByKey(this.MobId[i], "Sprite_Name") +"* x "  + this.MobCount[i] + "  \n";
		}
		for ( let i = 0; i < this.DropItemId.length; i++ ) {
			if ( this.DropItemId[i] ) {
				let AegisName = itemDB.tryGetParamOfLineByKey(this.DropItemId[i], "AegisName");
				let MobName = mobDB.tryGetParamOfLineByKey(this.DropItemMobId[i], "Sprite_Name");
				str += "" + (i+1) + ". item : *" + AegisName + "* "
					+ " from mob *" + MobName + "* "
					+ " rate " + (this.DropItemRate[i] / 100) + "%  \n"; 
			}
		}
		str += "\n\n";
		return str;
	}
}


class ClientQuest {
	id!:string;
	name!:string;
	skillid!:string;
	image!:string;
	longdesc!:string;
	shortdesc!:string;
	lineNum!:number;
}

function loadquestid2display(filePath :string) : Map<number,ClientQuest>|null
{
	if ( !fs.existsSync(filePath) ) {
		vscode.window.showErrorMessage("loadquestid2display: "+ filePath +": file not exists");
		return null;
	}

	let fileContentBytes = fs.readFileSync(filePath);

	// Replace comments with spaces
	let slash = '/'.charCodeAt(0);
	let nextLine = '\n'.charCodeAt(0);
	let space = ' '.charCodeAt(0);

	for ( let i = 0; i < fileContentBytes.length - 1; i++ )
		if ( fileContentBytes[i] == slash && fileContentBytes[i+1] == slash )
			while ( fileContentBytes[i] != nextLine && i < fileContentBytes.length )
				fileContentBytes[i++] = space;
	
	let fileContent : string = iconv.decode(fileContentBytes, codepage);
	
	let tokens : Array<string> = fileContent.split("#");

	let ret = new Map<number, ClientQuest>();

	let lineNum = 0;
	for ( let i = 0; i < tokens.length - 5; i += 6 ) {
		let n = i;

		let linesInQuestId = 0;
		let linesInQuest = 0;

			for ( let j = i; j < i + 6 && j < tokens.length; j++ ) {
			linesInQuest += tokens[j].split("\n").length - 1;
			if ( j == i )
				linesInQuestId = linesInQuest;
			tokens[j] = tokens[j].trim();
		}

		let key = parseInt(tokens[n]);
		if ( key < 1 ) {
			let str = "";
			for ( let j = i; j < i+6 && j < tokens.length; j++ ) 
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

enum e_athena_exportsyntax {
	FUNC,
	CONST,
	ITEM,
	MOB,
	SKILL
};

// tslint:disable: curly
function readCompletionsArrayFromFile(filePath: string)
{
	let fileContent = fs.readFileSync(filePath);
	let lines = fileContent.toString().split(/\r?\n/);
	let myCompletions = new Array();
	let i;

	for ( i = 0; i < lines.length; i++ ) {
		let tokens = lines[i].split("\t");
		if ( tokens.length < 2 )
			continue;	// Invalid file format, should be at least type and label

		const item = new vscode.CompletionItem(tokens[1]);
		let type = parseInt(tokens[0]);
		if ( type == e_athena_exportsyntax.MOB ) {
			continue;
		} else if ( type == e_athena_exportsyntax.ITEM ) {
			continue;
		} else if ( type == e_athena_exportsyntax.CONST )
			item.kind = vscode.CompletionItemKind.Constant;
		else if ( type == e_athena_exportsyntax.FUNC ) {
			item.kind = vscode.CompletionItemKind.Function;
			let functionInfo = new AthenaFunctionInfo(lines[i]);
			scriptFunctionDB.set(functionInfo.name, functionInfo);
		}
		else if ( type == e_athena_exportsyntax.SKILL ) {
			continue; //item.kind = vscode.CompletionItemKind.Class;
		} else
			item.kind = vscode.CompletionItemKind.Value;
		if ( tokens.length > 2 ) {
			item.detail = tokens[2];
			if ( type == e_athena_exportsyntax.CONST
				 )
				item.filterText = tokens[1] + " " + tokens[2];
		}
		if ( tokens.length > 3 ) {
			item.insertText = new vscode.SnippetString(tokens[3]);
			item.kind = vscode.CompletionItemKind.Method;
		}

		myCompletions.push(item);
	}	
	return myCompletions;
}

function getBeginningOfLinePosition(text : string, position : any) {
	while ( position > 0 ) {
		position--;
		if ( text.charAt(position) == '\r' || text.charAt(position) == '\n' ) {
			position++;
			return position;
		}
	}
	return position;	// 0
}

function getSymbolLabel(line : string)
{
	let tokens = line.split("\t");
	if ( tokens.length < 4 ) {
		if ( tokens.length == 3 ) {	// special case: mapflag
			if ( line.indexOf("\tmapflag\t") != -1 )
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
	if ( exnameBegin != -1 )
		exname = fullName.substr(exnameBegin + 2);
		
	let rusNameBegin = fullName.indexOf("|");
	if ( rusNameBegin != -1 ) {
		if ( exnameBegin != -1 )
			rusname = fullName.substring(rusNameBegin + 1, exnameBegin);
		else
			rusname = fullName.substring(rusNameBegin + 1);
	}

	let name = rusname ? fullName.substring(0, rusNameBegin) : exname ? fullName.substring(0, exnameBegin) : fullName;

	if ( !exname )
		exname = name;

	if ( exname && ( name == " " || name == "#" ) )
		name = "";

	if ( pos == "-" || pos == "function" ) {
		pos = "";
	} else {
		let lastIndexOfComma = pos.lastIndexOf(',');
		if ( lastIndexOfComma != -1 )
			pos = pos.substring(0, lastIndexOfComma);
	}

	let properties : string = "";
	if ( pos )
		properties += pos;

	if ( npctype.indexOf("duplicate(") != -1 ) {
		if ( properties )
			properties += "    ";
		properties += npctype;
	}

	if ( name && name != exname ) {
		if ( properties )
			properties += "    ";
		properties += name;
	}

	if ( rusname ) {
		if ( properties )
			properties += "    ";
		properties += rusname;
	}
	
	if ( properties )
		return exname + "    (" + properties + ")"
	else
		return exname;
}

class AthenaFuncParam {
	type: string;
	name: string;

	constructor(type : string, name : string) {
		this.name = name;
		this.type = type;
	}

	getLabel() : string 
	{
		return this.type + " " + this.name;
	}
}

class AthenaFunctionInfo {
	name : string;
	params: Array<AthenaFuncParam>;

	constructor(line: string) {
		let tokens = line.split("\t");
		this.name = tokens[1];
		let params = tokens.length > 2 ? tokens[2].split(",") : "";
		this.params = new Array<AthenaFuncParam>(params.length);
		for ( let i = 0; i < params.length; i++ ) {
			let delim = params[i].indexOf(' ');
			if ( delim != -1 )
				this.params[i] = new AthenaFuncParam(params[i].substring(0, delim).trim(), params[i].substring(delim, params[i].length).trim());
			else
				this.params[i] = new AthenaFuncParam("" , params[i]);
		}
	}

	getParamsLine() : string
	{
		let ret = "";
		for ( let i = 0; i < this.params.length; i++ ) {
			if ( i != 0 )
				ret += ", ";
			ret += this.params[i].getLabel();
		}
		return ret;
	}

	getLabel() : string {
		return this.name + "(" + this.getParamsLine() + ")";
	}
}


class AthenaDbCompletionItem extends vscode.CompletionItem {
	db : AthenaDB;
	dbLine : AthenaDBLine;

	constructor(label : string, kind : vscode.CompletionItemKind, db : AthenaDB, dbLine : AthenaDBLine)
	{
		super(label, kind);
		this.db = db;
		this.dbLine = dbLine;
	}

}


function checkWordEnds(c : string)
{
	return wordSeparators.indexOf(c) != -1 || isWhitespace(c);
}


function findWordReferencesInFile(filePath : string, words : Array<string>) : Array<vscode.Location>
{
	let ret = new Array<vscode.Location>();

	let fileContentBytes = fs.readFileSync(filePath);
	let fileContent : string = fileContentBytes.toString();

	let line = 0;
	let ofs = 0;

	for ( let i = 0; i < fileContent.length; i++ ) {
		if ( fileContent.charAt(i) == '\n' ) {
			line++;
			ofs = 0;
			continue;
		} 
		
		for ( let j = 0; j < words.length; j++ ) {
			let word = words[j];
			if ( fileContent.startsWith(word, i) 
				&& ( i == 0 || checkWordEnds(fileContent.charAt(i-1)) ) 
				&& ( i + word.length == fileContent.length-1 || checkWordEnds(fileContent.charAt(i + word.length)) ) 
				)
			{
				ret.push(new vscode.Location( vscode.Uri.file(filePath), new vscode.Range(new vscode.Position(line, ofs), new vscode.Position(line, ofs+word.length))));
			}
		}
				
		ofs++;
	}

	return ret;
}


function getDirectoryFileNamesRecursive(dirPath : string) : Array<string>
{
	let ret = Array<string>();

	let dirents : Array<Dirent> = fs.readdirSync(dirPath, { withFileTypes: true }) ;

	dirents.forEach(dirent => {
		if ( dirent.isDirectory() )
			ret = ret.concat(getDirectoryFileNamesRecursive(dirPath + "/" + dirent.name));
		else if ( dirent.isFile() )
			ret.push(dirPath + "/" + dirent.name);
	});

	return ret;
}


function getFilesForFindReferences() : Array<string>
{
	let resultsDb = getDirectoryFileNamesRecursive(athenaDbDir);
	let resultsNpc = getDirectoryFileNamesRecursive(athenaNpcDir);
	return resultsDb.concat(resultsNpc);
}


let filesForFindReferences = Array<string>();


function findWordReferencesInAllFiles(words : Array<string>)
{
	if ( !filesForFindReferences || filesForFindReferences.length == 0 )
		filesForFindReferences = getFilesForFindReferences();
	let ret = new Array<vscode.Location>();
	filesForFindReferences.forEach(f => {
		//console.debug(f);
		ret = ret.concat(findWordReferencesInFile(f, words));
	});
	return ret;
}

function copySearchRegex()
{
	let activeEditor = vscode.window.activeTextEditor;//get_active_editor();
    if (!activeEditor)
		return;
    var activeDoc = activeEditor.document;// get_active_doc(active_editor);
    if (!activeDoc)
        return;
    let selection = activeEditor.selection;
    if (!selection) {
        ;//show_single_line_error("Selection is empty");
        return;
	} 

	let text = activeDoc.getText(selection);
	if ( !text )
		return;

	vscode.env.clipboard.writeText(text);
}

function isDocumentAthenaDB(document : vscode.TextDocument) : boolean
{
	// Check auto-loaded DBs
	let autoLoadedDatabases = getAutoLoadedDatabases();
	let foundInAutoLoaded = autoLoadedDatabases.find(db => {
		let dbFile = db.findFileByFilePath(document.fileName);
		return dbFile != null;
	});

	if ( foundInAutoLoaded )
		return true;

	// Check cached mapping
	if ( documentToAthenaDBFile.has(document) )
		return true;

	// Check file format 
	if ( document.fileName.endsWith("_db.txt") 
	|| document.fileName.endsWith("_db2.txt") 
	|| formatFileName(document.fileName).includes(formatFileName(athenaDbDir)) ) 
	{
		let isLineDefOnNextLine = false;
		for ( let i = 0; i < 20 && i < document.lineCount-1; i++ ) {
			let lineText = document.lineAt(i).text;
			if ( (isLineDefOnNextLine || i == 0) && lineText.startsWith("//") && lineText.includes(",") ) {
				return true;
			}
			else if ( lineText.toLowerCase().startsWith("// structure of database") ) {
				isLineDefOnNextLine = true;
				continue;
			}
		}
	}
	
	return false;
}


let itemBonusTxtPath : string;
let questid2displaypath : string;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const tstart = new Date().getTime();

	const editorConf = vscode.workspace.getConfiguration("editor", null);
	wordSeparators = editorConf.get<string>("wordSeparators") || "";

	let conf = vscode.workspace.getConfiguration(languageIdLowerCase);

	function getConfValOrThrow<T>(settingName : string, description? : string) : T {
		let ret = conf.get<T>(settingName);
		if ( !ret ) {
			let err = "[" + (description||settingName) + "] setting is not set.";
			vscode.window.showErrorMessage(err);
			throw new Error(err);
		}
		return ret;
	}

	function formatDirNameFromConfig(dirName : string) : string {
		// crop leadng and traling whitespace
		dirName = dirName.trim();
		// crop leadng and traling " (Windows "copy path" function encloses path with "" by default)
		if ( dirName.startsWith("\"") && dirName.endsWith("\"") )
			dirName = dirName.substring(1, dirName.length - 1);
		if ( dirName.endsWith("/") || dirName.endsWith("\\") )
			dirName = dirName.substring(0, dirName.length - 1);
		return dirName;
	}

	let defaultAthenaDbColumnHighlighting : boolean|undefined;
	let defaultAthenaDbColumnHints : boolean|undefined;

	let itemDbFilePaths : string[] = [];
	let mobDbFilePaths : string[] = [];
	let mobSkillDbFilePaths : string[] = [];
	let constDBFilePath = "";

	// Split relative path related config setting to array of absolute path
	function getDbFilePathsFromConfiguration(settingName : string, desc : string) {
		let val = getConfValOrThrow<string>(settingName, desc);
		let arr = val.split(";");
		for ( let i = 0; i < arr.length; i++ )
			arr[i] = athenaDbDir + "/" + arr[i];
		return arr;
	}

	// Update plugin variables from config when config setting is changed or on init
	function updateSettingsFromConfiguration() {
		let conf = vscode.workspace.getConfiguration(languageIdLowerCase);
		mobImageURL = conf.get<string>("mobImageURL");
		itemImageURL = conf.get<string>("itemImageURL");
		skillImageURL = conf.get<string>("skillImageURL");
		defaultAthenaDbColumnHighlighting = conf.get<boolean>("defaultAthenaDbColumnHighlighting");
		defaultAthenaDbColumnHints = conf.get<boolean>("defaultAthenaDbColumnHints");
		
		is_rAthena = conf.get<boolean>("isRAthena", false);

		itemDbParamIndex = new ItemDBParamIndex();
		mobDbParamIndex = new MobDBParamIndex();
		skillDbParamIndex = new SkillDBParamIndex();
		mobSkillDBParamIndex = new MobSkillDBParamIndex();
		
		athenaDir = formatDirNameFromConfig(getConfValOrThrow<string>("athenaDirectory", "Athena directory"));
		athenaNpcDir = athenaDir + "/npc";

		if ( is_rAthena ) {
			athenaDbDir = athenaDir + "/db/re";
			itemDbFilePaths = [ athenaDbDir + "/item_db.txt" ];
			mobDbFilePaths = [ athenaDbDir + "/mob_db.txt" ];
			mobSkillDbFilePaths = [ athenaDbDir + "/mob_skill_db.txt" ];
		} else {
			athenaDbDir = athenaDir + "/db";
			itemDbFilePaths = [ athenaDbDir + "/item_db.txt", athenaDbDir + "/item_db2.txt" ];
			mobDbFilePaths = [ athenaDbDir + "/mob_db.txt", athenaDbDir + "/mob_db2.txt" ];
			mobSkillDbFilePaths = [ athenaDbDir + "/mob_skill_db.txt", athenaDbDir + "/mob_skill_db2.txt" ];
		}
		constDBFilePath = athenaDir + "/db/const.txt";
		
		itemBonusTxtPath = getConfValOrThrow("itemBonusTxtPath", "item_bonus.txt path");
		questid2displaypath = getConfValOrThrow("clientQuestid2displayPath", "Client questid2display.txt path");
		codepage = getConfValOrThrow("encoding", "Encoding");
	}

	updateSettingsFromConfiguration();

	vscode.workspace.onDidChangeConfiguration(event => {
		if ( event.affectsConfiguration(languageIdLowerCase) ) {
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

	const itemBonusDB = is_rAthena ? new ItemBonusDB_rAthena(itemBonusTxtPath) : new ItemBonusDB([ itemBonusTxtPath ]);

	let completionsTxtDir = context.extensionPath + "/res";
	let completionsTxtFn = completionsTxtDir + "/completions.txt";
	if ( !fs.existsSync(completionsTxtFn) ) {
		if ( is_rAthena )
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
		allCompletions.push(completionItem)
	});

	let referenceProvider = vscode.languages.registerReferenceProvider(languageId, {
		provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Location[]>
		{
			let wordRange = document.getWordRangeAtPosition(position, wordPattern);
			let word = document.getText(wordRange);
			let wordInt = parseInt(word);

			let result = Array<vscode.Location>();

			let itemDbLine = itemDB.nameToDbLine.get(word);
			if ( !itemDbLine && wordInt > 0 )
				itemDbLine = itemDB.idToDbLine.get(wordInt);
			if ( itemDbLine ) {
				let itemID = itemDbLine.params[itemDbParamIndex.ID];
				result = result.concat(findWordReferencesInAllFiles([itemID, word]));
			}

			let mobDbLine = mobDB.nameToDbLine.get(word);
			if ( !mobDbLine && wordInt > 0 )
				mobDbLine = mobDB.idToDbLine.get(wordInt);
			if ( mobDbLine ) {
				let mobId = mobDbLine.params[mobDbParamIndex.ID];
				result = result.concat(findWordReferencesInAllFiles([mobId, word]));
			}
			return result;
		}
	});

	let copySearchRegexCmd = vscode.commands.registerCommand("extension.CopySearchRegex", copySearchRegex);

	let gotoDefinitionProvider = vscode.languages.registerDefinitionProvider(languageId, {
		provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Location | vscode.Location[] | vscode.LocationLink[]>
		{


			let wordRange = document.getWordRangeAtPosition(position, wordPattern);
			let word = document.getText(wordRange);

			const mobDbLine = mobDB.nameToDbLine.get(word);
			if ( mobDbLine )
				return new vscode.Location( vscode.Uri.file(mobDbLine.filePath), new vscode.Position(mobDbLine.lineNum, 0) );

			const itemDbLine = itemDB.nameToDbLine.get(word);
			if ( itemDbLine )
				return new vscode.Location( vscode.Uri.file(itemDbLine.filePath), new vscode.Position(itemDbLine.lineNum, 0) );

			//const funcAndParam = getFunctionAndParameterInfo(document, position);

			if ( isWordQuestID(document, position) ) {
				const wordInt = parseInt(word);
				let result = new Array<vscode.Location>();
				if ( questDB ) {
					const serverQuest = questDB.idToDbLine.get(wordInt);
					if ( serverQuest )
						result.push(new vscode.Location(vscode.Uri.file(serverQuestDbPath), new vscode.Range(new vscode.Position(serverQuest.lineNum, 0), new vscode.Position(serverQuest.lineNum+1, 0))));
				}
				if ( questid2display ) {
					const clientQuest = questid2display.get(wordInt);
					if ( clientQuest )
						result.push(new vscode.Location(vscode.Uri.file(questid2displaypath), new vscode.Range(new vscode.Position(clientQuest.lineNum, 0), new vscode.Position(clientQuest.lineNum+1, 0))));
				}
				if ( result.length > 0 )
					return result;
			}	

			return null;
		}
	});


	class GetFunctionAndParameterInfoResult {
		func : AthenaFunctionInfo;
		activeParameter : number;

		constructor(func: AthenaFunctionInfo, activeParameter : number) {
			this.func = func;
			this.activeParameter = activeParameter;
		}
	}

	function getFunctionAndParameterInfo(document: vscode.TextDocument, position: vscode.Position)
	{
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
			if ( line.charAt(tmpOfs) == '\"' && line.charAt(tmpOfs-1) != '\\' ) {
				if ( quotesNum == 0 )
					prevQuotePos = tmpOfs;
					quotesNum++;
			}
		} while ( tmpOfs > 0 );
		if ( quotesNum % 2 == 1 )
			lineOfs = prevQuotePos - 1;

		while ( lineOfs > 0 ) {
			if ( line.charAt(lineOfs) == ',' ) {
				if ( activeParameter == -1 )
					activeParameter = 0;
				activeParameter++;
				lineOfs--;
				continue;
			} else if ( line.charAt(lineOfs) == '\"' ) {
				let tmpOfs = lineOfs;
				let quotesNum = 0;
				let prevQuotePos = -1;
				do {
					tmpOfs--;
					if ( line.charAt(tmpOfs) == '\"' && line.charAt(tmpOfs-1) != '\\' ) {
						if ( quotesNum == 0 )
							prevQuotePos = tmpOfs;
							quotesNum++;
					}
				} while ( tmpOfs > 0 );

				if ( quotesNum % 2 == 1 ) {
					// ���� ������ ������
					lineOfs = prevQuotePos - 1;
					continue;
				} else {
					lineOfs--;
					continue;
				}
			} else if ( line.charAt(lineOfs) == ')' ) {
				let braceLv = 1;
				do {
					lineOfs--;
					if ( line.charAt(lineOfs) == '(' )
						braceLv--;
					else if ( line.charAt(lineOfs) == ')' )
						braceLv++;
				} while ( braceLv > 0 && lineOfs >= 0 );
				lineOfs--;
				// ����� ������� ��������� �������� ��������� ������� ����� ��������
				while ( lineOfs >= 0 && isWhitespace(line.charAt(lineOfs)) )
					lineOfs--;

				let tmp = new vscode.Position(position.line, lineOfs);
				let wordRange = document.getWordRangeAtPosition(tmp, wordPattern);
				if ( wordRange == null ) {
					lineOfs--;
					continue;
				}
				let word = document.getText(wordRange);
				let functionInfo = scriptFunctionDB.get(word);
				
				if ( functionInfo != null )
					lineOfs = wordRange.start.character - 1;
				continue;
			} else if ( line.charAt(lineOfs) == '(' ) {
				if ( activeParameter == -1 )
					activeParameter = 0;
			}

			p = new vscode.Position(position.line, lineOfs);
			let wordRange = document.getWordRangeAtPosition(p, wordPattern);
			let word = document.getText(wordRange);
			let functionInfo = scriptFunctionDB.get(word);
			if ( functionInfo != null )
				return new GetFunctionAndParameterInfoResult(functionInfo, activeParameter < functionInfo.params.length ? activeParameter : functionInfo.params.length - 1);

			if ( activeParameter == -1 )
				activeParameter = 0;
			lineOfs--;
		}
		return null;
	}

	let signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(languageId, {
		provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp>
		{

			let hover = provideHover(document, position, token);

			let fp = getFunctionAndParameterInfo(document, position);
			if ( fp ) {
				let functionInfo = fp.func;
				let activeParameter = fp.activeParameter;

				let ret = new vscode.SignatureHelp();
				let infos = new Array<vscode.SignatureInformation>();
				let signatureLabel = functionInfo.getLabel();
				let info = new vscode.SignatureInformation(signatureLabel);
				functionInfo.params.forEach(p => {
					let paramLabel = p.getLabel();
					info.parameters.push(new vscode.ParameterInformation(paramLabel, new vscode.MarkdownString(hover)));
				});
				infos.push(info);
				ret.signatures = infos;
				ret.activeSignature = 0;
				if ( activeParameter != -1 )
					ret.activeParameter = activeParameter;
				return ret;
			}

			// ���� �� ��� ��� ������ �� �������, ������ ��������� ������� �� �������. ��������� �� ������������� ����������� ���������
			if ( isDocumentAthenaDB(document) ) {
				let dbFile = ensureDocumentAthenaDbFile(document);
				let dbLine = dbFile.lines[position.line];

				let activeParam = dbLine.getParamIdxAtPosition(position);

				let ret = new vscode.SignatureHelp();
				let infos = new Array<vscode.SignatureInformation>();
				let signatureLabel = "";
				
				dbFile.parentDb.paramNames.forEach(p => {
					signatureLabel += "[" + p + "]\n"	
				});
				let info = new vscode.SignatureInformation(signatureLabel);
				for ( let i = 0; i < dbFile.parentDb.paramNames.length; i++ ) {
					let p = dbFile.parentDb.paramNames[i];
					let documentation = dbFile.parentDb.getParamDocumentation(i);
					let str = hover || "";
					if ( documentation )
						str += "  \n" + documentation;

					info.parameters.push(new vscode.ParameterInformation("[" + p + "]", new vscode.MarkdownString(str)));

				}
				dbFile.parentDb.paramNames.forEach(p => {
				});
				infos.push(info);
				ret.signatures = infos;
				ret.activeSignature = 0;
				if ( activeParam != undefined )
					ret.activeParameter = activeParam;
				return ret;

			}
		}
	});


	function isWordQuestID(document : vscode.TextDocument, position : vscode.Position)
	{
		const wordRange = document.getWordRangeAtPosition(position, wordPattern);
		const word = document.getText(wordRange);
		if ( !word )
			return false;

		const funcInfo = getFunctionAndParameterInfo(document, position);
		const paramNameLowerCase = ( funcInfo && funcInfo.activeParameter >= 0 ) ? funcInfo.func.params[funcInfo.activeParameter].name.toLowerCase() : "";

		const wordInt = parseInt(word);
		return wordInt >= 1000 && ( document.fileName.includes("quest_db.txt") 
			|| document.fileName.includes("questid2display.txt") 
			|| document.lineAt(position).text.toLowerCase().indexOf("quest") != -1 
			|| paramNameLowerCase.includes("quest_id") || paramNameLowerCase.includes("questid") );
	}

	function provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) : string | undefined
	{
		let colHint = "";
		if ( isDocumentAthenaDB(document) && position.line != 0 ) {
			let dbFile = ensureDocumentAthenaDbFile(document);
			let db = dbFile.parentDb;
			let parsedLine = dbFile.lines[position.line];
			
			let i = 0;
			for ( i = 0; i < parsedLine.paramRanges.length; i++ )
				if ( parsedLine.paramRanges[i].contains(position) ) {
					colHint = "Column " + i;
					if ( i < db.paramNames.length )
						colHint += "  \n" + db.explainParamByLine(parsedLine, i, false);
					//colHint += "  \n  \n";
					break;
				}
		}

		let wordRange = document.getWordRangeAtPosition(position, wordPattern);
		let word = document.getText(wordRange);
		let wordInt = parseInt(word);

		let functionInfo = scriptFunctionDB.get(word);
		if ( functionInfo != null ) {
			if ( colHint.length )
				colHint += "  \n___  \n"
			return colHint + functionInfo.getLabel();
		}

		let DBs = [ itemDB, mobDB, skillDB ];
		
		let isNameExplained = false;
		for ( let i = 0; i < DBs.length; i++ ) { // no foreach because we use return which cant be used inside foreach
			let dbLine = DBs[i].nameToDbLine.get(word);
			if ( dbLine ) {
				if ( colHint.length )
					colHint += "  \n___  \n"

				colHint += DBs[i].explainLine(dbLine, false);
				isNameExplained = true;
			}
		}

		let itemBonusExplanation = itemBonusDB.explainBonus(word);
		if ( itemBonusExplanation ) {
			if ( colHint.length )
				colHint += "  \n___  \n"
			return colHint + itemBonusExplanation;
		}

		let constDbEntry = constDB.get(word.toLowerCase());
		if ( constDbEntry ) {
			let val = "*script constant* " + constDbEntry.name;
			if ( constDbEntry.val != undefined )
				val += " = " + constDbEntry.val;
			if ( colHint.length )
				colHint += "  \n___  \n"
			colHint += val;
		}

		let funcInfo = getFunctionAndParameterInfo(document, position);
		const paramNameLowerCase = ( funcInfo && funcInfo.activeParameter >= 0 ) ? funcInfo.func.params[funcInfo.activeParameter].name.toLowerCase() : "";
			
		if ( isWordQuestID(document, position) ) {
			let strServer : string = "";
			let strClient : string = "";
			if ( questDB ) {
				const serverQuest = <AthenaQuestDBLine>questDB.idToDbLine.get(wordInt);
				if ( serverQuest )
					strServer = serverQuest.getStringForTooltip();
			}
			if ( questid2display ) {
				const clientQuest = questid2display.get(wordInt);
				if ( clientQuest )
					strClient = makeMarkdownLink(clientQuest.name, questid2displaypath, clientQuest.lineNum) + "  \n"+ clientQuest.longdesc + "  \n*" + clientQuest.shortdesc + "*  \n";
			}

			let str : string = "";
			if ( strServer && strClient )
				str = "**server**  \n___  \n" + strServer + "**client**  \n" + strClient;
			else if ( strServer )
				str = strServer;
			else if ( strClient )
				str = strClient;

			if ( str.length )
				return colHint + str;
		}

		if ( wordInt && funcInfo && funcInfo.activeParameter != -1 ) {
			if ( paramNameLowerCase == "mob_id" || paramNameLowerCase == "mobid" || paramNameLowerCase == "mob" || paramNameLowerCase == "monster" || paramNameLowerCase == "class_" || paramNameLowerCase == "class" ) {
				let mobDbLine = mobDB.idToDbLine.get(wordInt);
				if ( mobDbLine ) {
					if ( colHint.length )
						colHint += "  \n___  \n"

					return colHint + mobDB.explainLine(mobDbLine, false, position);
				}
			}
			else if ( paramNameLowerCase == "itemid" || paramNameLowerCase == "itid" || paramNameLowerCase == "item" ) {
				let itemDbLine = itemDB.idToDbLine.get(wordInt);
				if ( itemDbLine ) {
					if ( colHint.length )
						colHint += "  \n___  \n"
					return colHint + itemDB.explainLine(itemDbLine, false, position);
				}
			}
		}

		// Test for NPC view
		let lineText = document.lineAt(position).text;
		let match = lineText.match(/[A-Za-z0-9@,_ ]*\t(?:script|warp|shop|cashshop|duplicate\([^)]*\))\t[^\t]*\t([^,]*)/);
		if ( match && match.length == 2 && word == match[1] ) {
			let npcView : number|undefined;
			if ( constDbEntry && constDbEntry.val )
				npcView = constDbEntry.val;
			else if ( isFullyNumericString(word) )
				npcView = wordInt;
			
			if ( npcView ) {
				if ( colHint.length )
					colHint += "  \n___  \n"
				let url = mobImageURL ? mobImageURL.replace("MOBID", npcView.toString()) : "";

				colHint += "![image]("+url+")";
			}

		}
		if ( colHint )
			return colHint;

		return undefined;
	}



	let hoverProvider = vscode.languages.registerHoverProvider(languageId, {
		
		
		provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken)
		{
			let str = provideHover(document, position, token);
			if ( str )
				return new vscode.Hover(str, document.getWordRangeAtPosition(position, wordPattern));
			else
				return null;
		}
	});

	let completionProvider = vscode.languages.registerCompletionItemProvider("*", {	// "*"" to not overprioritize (and therefore not hide) default word-completions. We'll reject completions on foreign languages internally.
		

		resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem>
		{
			if ( item instanceof AthenaDbCompletionItem ) {
				if ( !item.documentation )
					item.documentation = new vscode.MarkdownString(item.db.explainLine(item.dbLine, false));
			}

			let itemBonusExplanation = itemBonusDB.explainBonus(item.label);
			if ( itemBonusExplanation ) 
				item.documentation = new vscode.MarkdownString(itemBonusExplanation);
			return item;
		},

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			if ( document.languageId != languageId )
				return null;

			return allCompletions;
		}
	});

	let navProvider = vscode.languages.registerDocumentSymbolProvider(languageId, {

		provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.SymbolInformation[] {
				if ( isDocumentAthenaDB(document) )
					return ensureDocumentAthenaDbFile(document).symbols;

				let symbols = new Array<vscode.SymbolInformation>();

				let text = document.getText();
				let curlyCount = 0;
				let isString = false;
				let openCurlyOffset = -1;	// Current symbol beginning

				let label = "";
				let bodyStart = 0, bodyEnd = 0;

				let innerSymbols = new Array<vscode.SymbolInformation>();

				for ( var i = 0; i < text.length; i++ ) {
					var c = text.charAt(i);

					// Skip strings
					if ( c == '\"' && i != 0 && text.charAt(i-1) != '\\' ) {
						isString = !isString;
						continue;
					}
					if ( isString )
						continue;

					// Skip line comments
					if ( c == '/' && i < text.length - 1 && text.charAt(i+1) == '/' ) {
						while ( text.charAt(i) != '\r' && text.charAt(i) != '\n' && i < text.length )
							i++;
						continue;
					}
					// Skip block comments
					if ( c == '/' && i < text.length - 1 && text.charAt(i+1) == '*' ) {
						while ( text.charAt(i) != '*' && i < text.length - 1 && text.charAt(i+1) != '/' )
							i++;
						continue;
					}

					var type = -1;
					var line = document.fileName;
					if ( c == '{' ) {
						if ( curlyCount == 0 )
							openCurlyOffset = i;
						curlyCount++;
					} else if ( c == '}' && curlyCount > 0 ) {
						curlyCount--;
						if ( curlyCount == 0 && openCurlyOffset != -1 ) {
							var beginningOfLine = getBeginningOfLinePosition(text, openCurlyOffset);
							line = text.substring(beginningOfLine, openCurlyOffset);

							if ( line.indexOf("\tscript\t") != -1 ) {
								if ( line.indexOf("function\tscript\t") != -1 )
									type = vscode.SymbolKind.Function;
								else
									type = vscode.SymbolKind.Namespace;
								label = getSymbolLabel(line);
								bodyStart = beginningOfLine;
								bodyEnd = i;
								openCurlyOffset = -1;
							}
						}
					} else if ( c == '\r' || c == '\n' ) {
						let matchResult;
						let beginningOfLine = getBeginningOfLinePosition(text, i);
						line = text.substring(beginningOfLine, i);
						if ( line.indexOf("\tduplicate(") != -1 ) {
							type = vscode.SymbolKind.EnumMember;
							label = getSymbolLabel(line);
						} else if ( line.indexOf("\twarp\t") != -1 ) {
							type = vscode.SymbolKind.Event;
							label = getSymbolLabel(line);
						} else if ( line.indexOf("\tmonster\t") != -1 ) {
							type = vscode.SymbolKind.Object;
							label = line;
						} else if ( line.indexOf("\tmapflag\t") != -1 ) {
							type = vscode.SymbolKind.TypeParameter;
							label = line;
						} else if ( line.indexOf("\tshop\t") != -1 ) {
							type = vscode.SymbolKind.Interface;
							label = getSymbolLabel(line);
						} else if ( line.indexOf("\tcashshop\t") != -1 ) {
							type = vscode.SymbolKind.Interface;
							label = getSymbolLabel(line);
						} else if ( matchResult = line.match(/On[^:]*:/) ) {
							type = vscode.SymbolKind.Class;
							label = matchResult[0];
						} else if ( matchResult = line.trim().match(/function\t([^\t]*)\t{/) ) {
							if ( matchResult.length >= 2 ) {
								type = vscode.SymbolKind.Method;
								label = matchResult[1];
							}
						}
						bodyStart = beginningOfLine;
						bodyEnd = i;
					}
					if ( type != -1 ) {
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
		provideWorkspaceSymbols(query: string, token: vscode.CancellationToken) {
			let ret = Array<vscode.SymbolInformation>();
			// let consumed = new Array<boolean>(query.length);

			query = query.toLowerCase();

			let databases = [ itemDB, mobDB, skillDB ];
			let allSymbols = new Array<vscode.SymbolInformation>();
			try {
				databases.forEach(db => {
					db.files.forEach(f => {
						allSymbols = allSymbols.concat(f.symbols);
						if ( token.isCancellationRequested )
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
					if ( !s.name.toLowerCase().includes(query) )
						return;

					ret.push(s);

					if ( token.isCancellationRequested )
						throw new Error();
				});
			} catch ( Error ) {	// Cancelled
				return new Array<vscode.SymbolInformation>();
			} 


			return ret;
		}
	});

	context.subscriptions.push(completionProvider, navProvider, hoverProvider, gotoDefinitionProvider, referenceProvider, copySearchRegexCmd, signatureHelpProvider, workspaceSymbolsProvider);

	let timeout: NodeJS.Timer | undefined = undefined;

	const columnColors = [ 
		'#AA000011', 
		'#00AA0011', 
		'#0000AA11', 
		'#00AAAA11', 
		'#AA00AA11', 
		'#AAAA0011' 
	];

	let needUpdateAthenaDB = false;

	function updateDecorations(forceUpdateDecorationTypes? : boolean) {
		let activeEditor = vscode.window.activeTextEditor;

		if (!activeEditor)
			return;
		
		let document = activeEditor.document;

		if ( document.languageId != languageId )
			return;

		let isAthenaDB = isDocumentAthenaDB(document);

		if ( !isAthenaDB )
			return;

		let enableHighlight = forceDbColumnHighlight.get(document.fileName);
		if ( enableHighlight == null )
			enableHighlight = isAthenaDB && defaultAthenaDbColumnHighlighting;

		let enableHints = forceDbColumnHints.get(document.fileName);
		if ( enableHints == null )
			enableHints = isAthenaDB && defaultAthenaDbColumnHints;

		let colDecorationTypes = documentToDecorationTypes.get(document);
		if ( forceUpdateDecorationTypes && colDecorationTypes != null ) {
			for ( let i = 0; i < colDecorationTypes.length; i++ )
				activeEditor.setDecorations(colDecorationTypes[i], new Array(0));
			documentToDecorationTypes.delete(document);
			colDecorationTypes = undefined;
		}

		let dbFile = needUpdateAthenaDB ? initDocumentAthenaDbFile(document) : ensureDocumentAthenaDbFile(document);
		let db = dbFile.parentDb;

		needUpdateAthenaDB = false;

		if ( db.paramNames.length < 2 )
			return;

		if ( !colDecorationTypes ) {
			colDecorationTypes = new Array<vscode.TextEditorDecorationType>(0);
			for ( let i = 0; i < db.paramNames.length; i++ )
				colDecorationTypes.push(vscode.window.createTextEditorDecorationType({
					backgroundColor: enableHighlight ? columnColors[i % columnColors.length] : undefined,
					before: enableHints ? { contentText: db.paramNames[i] + ":", color: "#88888888" } : undefined,
					rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
				}));
			documentToDecorationTypes.set(document, colDecorationTypes);
		}

		if ( !enableHighlight && !enableHints ) {
			for ( let i = 0; i < colDecorationTypes.length; i++ )
				activeEditor.setDecorations(colDecorationTypes[i], new Array(0));
			return;
		}		

		let decorations = new Array(colDecorationTypes.length);
		for ( let i = 0; i < decorations.length; i++ )
			decorations[i] = new Array();

		for ( let i = 0; i < dbFile.lines.length; i++ ) {
			const athenaDbLine = dbFile.lines[i];
			for ( let j = 0; j < athenaDbLine.params.length; j++ ) {
				let range = athenaDbLine.paramRanges[j];
				if ( !enableHints )	// Do not highlight trailing comma if hints enabled (otherwise it will apply decoration to the hint as well)
					range = new vscode.Range(range.start, range.end.translate(0, 1));
				const decoration = { range: range };
				decorations[j%colDecorationTypes.length].push(decoration);
			}
		}

		for ( let i = 0; i < colDecorationTypes.length; i++ ) 
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

	function countOccurences(haystack : string, needle : string) {
		let index = 0;
		let count = 0;
		while ( true ) {
			index = haystack.indexOf(needle, index);
			if ( index == -1 )
				return count;
			else {
				index += needle.length;
				count++;
			}
		}
	}

	vscode.window.onDidChangeTextEditorSelection(event => {
		let selection = event.selections[0];
		if ( isDocumentAthenaDB(event.textEditor.document) && webviewPanel ) { 
			let requireUpdateWebview = selection.start.line != webviewPanelLineNum;
			if ( !requireUpdateWebview ) {
				let dbFile = ensureDocumentAthenaDbFile(event.textEditor.document);
				let newActiveParam = dbFile.getParamIdxAtPosition(selection.start);
				if ( newActiveParam != webviewPanelActiveParam )
					requireUpdateWebview = true;
			}
			if ( requireUpdateWebview )
				updateWebviewContent();
		}
	});

	vscode.workspace.onDidChangeTextDocument(event => {
		let document = event.document;
		let dbFile = isDocumentAthenaDB(document) ? ensureDocumentAthenaDbFile(document) : null;
		if ( dbFile ) {
			for ( let i = 0; i < event.contentChanges.length; i++ ) {
				let change = event.contentChanges[i];
				for ( let l = change.range.start.line; l <= change.range.end.line; l++ ) {
					dbFile.updateLine(document, l);

					if ( activeEditor && activeEditor.selection.start.line == change.range.start.line && webviewPanel )
						updateWebviewContent();
				}
			}
		}

		if (activeEditor && event.document === activeEditor.document ) {
			// Update decorations only if added / removed column / row (i.e. commas count / line breaks count in prev. text and new text don't match)
			for ( let i = 0; i < event.contentChanges.length; i++ ) {
				let change = event.contentChanges[i];
				let prevText = event.document.getText(change.range);
				let numColumnsChanged = countOccurences(prevText, ',') != countOccurences(change.text, ',');
				let numRowsChanged = countOccurences(prevText, '\n') != countOccurences(change.text, '\n');
				if ( numColumnsChanged || numRowsChanged ) {
					if ( numRowsChanged )
						needUpdateAthenaDB = true;
					triggerUpdateDecorations();
				}

			};
		}

	}, null, context.subscriptions);


	vscode.commands.registerCommand("extension.toggleAthenaDbColumnHighlighting", () => {
		let activeEditor = vscode.window.activeTextEditor;
		if ( !activeEditor )
			return;
		let currentSetting = forceDbColumnHighlight.get(activeEditor.document.fileName);
		if ( currentSetting == null )
			currentSetting = isDocumentAthenaDB(activeEditor.document) && defaultAthenaDbColumnHighlighting;
		currentSetting = !currentSetting;
		forceDbColumnHighlight.set(activeEditor.document.fileName, currentSetting);
		updateDecorations(true);
	});

	vscode.commands.registerCommand("extension.toggleAthenaDbColumnHints", () => {
		let activeEditor = vscode.window.activeTextEditor;
		if ( !activeEditor )
			return;
	
		let currentSetting = forceDbColumnHints.get(activeEditor.document.fileName);
		if ( currentSetting == null )
			currentSetting = isDocumentAthenaDB(activeEditor.document) && defaultAthenaDbColumnHints;
		currentSetting = !currentSetting;
		forceDbColumnHints.set(activeEditor.document.fileName, currentSetting);
		updateDecorations(true);
	});

	vscode.commands.registerCommand("extension.sortLuaKeyValTableInSelection", () => {
		sortLuaKeyValTableInSelection();
	});

	vscode.commands.registerCommand("extension.toggleLinePreview", () => {
		if ( !webviewPanel ) {
			webviewPanel = vscode.window.createWebviewPanel("eapreview", "DB Entry Preview", vscode.ViewColumn.Two, {
				enableScripts: true
			});
			updateWebviewContent();

			webviewPanel.onDidDispose(
				() => {
					webviewPanel = undefined;
				},
				null,
				context.subscriptions
			  );
				
			  webviewPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
					case 'selectParameter':
						if ( !isDocumentAthenaDB(webviewPanelEditor.document) || webviewPanelLineNum == undefined )
							return;
						
						let dbFile = ensureDocumentAthenaDbFile(webviewPanelEditor.document);
						if ( webviewPanelLineNum >= dbFile.lines.length ) {
							vscode.window.showErrorMessage("invalid line selected");
							return;
						}
						let dbLine = dbFile.lines[webviewPanelLineNum];

						let paramIndex = dbFile.parentDb.getParamIndex(message.text);
						if ( paramIndex < 0 || paramIndex >= dbLine.paramRanges.length )
							return;


						
						let selection = new vscode.Selection(dbLine.paramRanges[paramIndex].start, dbLine.paramRanges[paramIndex].start);
						
						//vscode.workspace.openTextDocument(webviewPanelEditor.document.fileName);
						vscode.window.showTextDocument(webviewPanelEditor.document, { viewColumn : vscode.ViewColumn.One, selection : selection });
					}
				},
				undefined,
				context.subscriptions
			);

		} else {
			webviewPanel.dispose();
			webviewPanel = undefined;
		}
	});

	vscode.commands.registerCommand("extension.copyEmbedHtml", () => {
		let activeEditor = vscode.window.activeTextEditor;
		if ( !activeEditor )
			return;
		let wordRange = activeEditor.document.getWordRangeAtPosition(activeEditor.selection.start, wordPattern);
		let word = activeEditor.document.getText(wordRange);
		let itemDBLine = itemDB.nameToDbLine.get(word);
		let mobDBLine = mobDB.nameToDbLine.get(word);
		let skillDBLine = skillDB.nameToDbLine.get(word);
		let dbLine = itemDBLine || mobDBLine || skillDBLine;
		if ( !dbLine ) {
			vscode.window.showErrorMessage("Failed to find item/mob/skill: '"+word+"'.");
			return;
		}

		if ( itemDBLine ) {
			let itemId = itemDBLine.getIntParamByIndex(itemDbParamIndex.ID);
			let itemType = itemDBLine.getIntParamByIndex(itemDbParamIndex.Type);
			//let itemSection : string;

			let URL : string;

			if ( !itemId )
				return;

			if ( itemType == IT.WEAPON || itemType == IT.ARMOR || itemType == IT.AMMO )
				URL = getConfValOrThrow<string>("databaseURL.equipItem");
			else if ( itemType == IT.CARD )
				URL = getConfValOrThrow<string>("databaseURL.cardItem");
			else
				URL = getConfValOrThrow<string>("databaseURL.normalItem");


			URL = URL.replace("ITEMID", itemId.toString());

			if ( !itemImageURL ) {
				vscode.window.showErrorMessage("Item image URL setting is not set");
				return;
			}

			let imageURL = itemImageURL.replace("ITEMID", itemId.toString());
			let itemVisibleName = itemDBLine.getParamByIndex(itemDbParamIndex.visibleName());

			vscode.env.clipboard.writeText("<a href=\""+ URL +"\"><img src=\""+imageURL+"\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">"+itemVisibleName+"</a>");
			vscode.window.showInformationMessage("HTML code to embed '"+ itemVisibleName +"' has been copied to the clipboard.");
		} else if ( mobDBLine ) {
			let mobId = mobDBLine.getIntParamByIndex(mobDbParamIndex.ID);
			if ( !mobId )
				return;
			let URL = getConfValOrThrow<string>("databaseURL.mob");
			URL = URL.replace("MOBID", mobId.toString());

			if ( !mobImageURL ) {
				vscode.window.showErrorMessage("Mob image URL setting is not set");
				return;
			}

			let imageURL = mobImageURL.replace("MOBID", mobId.toString());

			let mobVisibleName = mobDBLine.getParamByIndex(mobDbParamIndex.visibleName());
			vscode.env.clipboard.writeText("<a href=\""+ URL +"\"><img src=\""+ imageURL +"\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">"+ mobVisibleName +"</a>");
			vscode.window.showInformationMessage("HTML code to embed '"+ mobVisibleName +"' has been copied to the clipboard.");
		} else if ( skillDBLine ) {
			let skillId = skillDBLine.getIntParamByIndex(skillDbParamIndex.id)
			let skillTechNameLower = skillDBLine.getParamByIndex(skillDbParamIndex.techName)?.toLowerCase();
			let skillVisibleName = skillDBLine.getParamByIndex(skillDbParamIndex.defaultVisibleName());

			if ( !skillId || !skillTechNameLower )	// skill_id=0 is valid
				return;

			let URL = getConfValOrThrow<string>("databaseURL.skill");
			URL = URL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", skillTechNameLower);

			if ( !skillImageURL ) {
				vscode.window.showErrorMessage("Skill image URL setting is not set");
				return;
			}

			let imageURL = skillImageURL.replace("SKILLID", skillId.toString()).replace("SKILLNAME", skillTechNameLower);

			vscode.env.clipboard.writeText("<a href=\""+ URL +"\"><img src=\""+ imageURL +"\" height=\"24\" style=\"vertical-align:middle; padding-right: 10px\">"+skillVisibleName+"</a>");
			vscode.window.showInformationMessage("HTML code to embed '"+ skillVisibleName +"' has been copied to the clipboard.");
		}
	});

	vscode.commands.registerCommand("extension.findItemDesc", () => {
		let activeEditor = vscode.window.activeTextEditor;
		if ( !activeEditor )
			return;
		let wordRange = activeEditor.document.getWordRangeAtPosition(activeEditor.selection.start, wordPattern);
		let word = activeEditor.document.getText(wordRange);
		//let skillDBLine = skillDB.nameToDbLine.get(word);
		let itemId : number|undefined;
		if ( isFullyNumericString(word) )
			itemId = parseInt(word);
		else {
			let itemDBLine = itemDB.nameToDbLine.get(word);
			if ( !itemDBLine ) {
				vscode.window.showErrorMessage("item" + word + " not found in db");
				return;
			}
			itemId = itemDBLine.getIntParamByIndex(itemDbParamIndex.ID);
			if ( !itemId ) {
				vscode.window.showErrorMessage("item" + word + " has no ID");
				return;
			}
		}

		let itemInfoFileName = getConfValOrThrow<string>("itemInfoPath", "iteminfo path");
		if ( !fs.existsSync(itemInfoFileName) || !fs.statSync(itemInfoFileName).isFile() ) {
			vscode.window.showErrorMessage(itemInfoFileName + " not found or is not a file");
			return;
		}

		let fileContent = fs.readFileSync(itemInfoFileName);
		//let fileContentStr = iconv.decode(fileContent, codepage);
		let ofs = fileContent.indexOf("["+itemId+"]");
		if ( ofs == -1 ) {
			vscode.window.showErrorMessage("item with ID=" + itemId + " not found in file " + itemInfoFileName);
			return;
		}

		let ret = vscode.workspace.openTextDocument(itemInfoFileName);
		ret.then(onItemInfoOpenSuccess, onItemInfoOpenFailed);
		function onItemInfoOpenSuccess(document: vscode.TextDocument) {
			let pos = document.positionAt(ofs);
			vscode.window.showTextDocument(document, { selection : new vscode.Selection(pos, pos) });
		}
		function onItemInfoOpenFailed(reason : any) {
			vscode.window.showErrorMessage("Failed to open itemInfo file "+ itemInfoFileName +" in VSCODE");
		}
	
	

	});

	function updateWebviewContent() {
		if ( !webviewPanel )
			return;
		let editor = vscode.window.activeTextEditor;
		if ( !editor )
			return;
		
		let document = editor.document;
		let selection = editor.selection;
		if ( !selection || !document )
			return;
		if ( !isDocumentAthenaDB(document) )
			return;
			
		let dbFile = ensureDocumentAthenaDbFile(document);
		let dbLine = selection.start.line <= dbFile.lines.length ? dbFile.lines[selection.start.line] : null;
		if ( !dbLine )
			return;

		webviewPanelEditor = editor;
		webviewPanelLineNum = editor.selection.start.line;
		webviewPanelActiveParam = dbLine.getParamIdxAtPosition(editor.selection.start);
		webviewPanel.webview.html = dbFile.parentDb.explainLine(dbLine, true, selection.start);
	}

	function syncWithAthena() {
		function replaceBetween(src : string, after : string, before : string, replacement : string) : string {
			let startIndex = src.indexOf(after);
			if ( startIndex < 0 )
				throw new Error("Failed to find start index: " + after);

			startIndex += after.length;

			let endIndex = src.indexOf(before, startIndex);
			if ( endIndex < 0 )
				throw new Error("Failed to find end index: " + before);
			return src.substring(0, startIndex) + replacement + src.substring(endIndex);
		}

		function escRegex(src : string) : string {
			let dst = "";
			for ( let i = 0; i < src.length; i++ ) {
				if ( src[i] == '.' || src[i] == '*' || src[i] == '[' || src[i] == ']' || src[i] == '(' || src[i] == ')' || src[i] == '?' ) {
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
			["OnPCDieEvent",	"Executed when PC becomes dead." ],
			["OnPCKillEvent",	"Executed when PC kills another PC. Some skills may not invoke this." ],
			["OnNPCKillEvent"],
			["OnPCLoginEvent",	"Executed when PC logs in" ],
			["OnPCLogoutEvent",	"Executed when PC logs out" ],
			["OnPCLoadMapEvent",	"Executed when PC loads specified map (only if map 'loadevent' mapflag is specified)" ],
			["OnPCLoadNPCMapEvent",	"Executed when PC loads NPC map" ],
			["OnPCBaseLvUpEvent",	"Executed on base level up" ],
			["OnPCJobLvUpEvent",	"Executed on Job level up" ],
			!is_rAthena ? ["OnUpdateMarker",	"Executed when PC ends talking with NPC or when PC loads NPC map" ] : undefined,
			["OnTouch_",	"Executed when PC touches NPC area" ],
			["OnTouch",	"Executed when PC touches NPC area but only if NPC is not busy with another PC" ],
			["OnTouchNPC",	"When mob comes into OnTouch area" ],
			["OnInit",	"When script loads/reloads" ],
			["OnInstanceInit",	"When instance is created" + !is_rAthena ? "(need IIF_INITINSTANCENPC)" : "" ],
		];

		staticDefinitions.forEach(def => {
			if ( !def )
				return;
			completionsTxt += "1\t" + def[0] + "\t" + def[1] + "\n"; 
		});

		// Write completions.txt functions
		let scriptCppPath = athenaDir + "/src/map/script.cpp";
		let fileContentStr : string = fs.readFileSync(scriptCppPath).toString();
		let startScriptFunctionDefIndex = fileContentStr.indexOf("struct script_function buildin_func[] = {");
		let funcNames = "";

		if ( startScriptFunctionDefIndex != -1 ) {
			fileContentStr = fileContentStr.substr(startScriptFunctionDefIndex);
			fileContentStr.split("\n").forEach(line => {
				let startCommentIdx = line.indexOf("//");
				if ( startCommentIdx >= 0)
					line = line.substring(0,startCommentIdx);

				let name : string;
				let args : string;
				let match;
				match = line.match(/BUILDIN_DEF\(([^,]*),[ ]*"([^"]*)"\),/) || line.match(/BUILDIN_DEF2\([^,]*,[ ]*"([^"]*)",[ ]*"([^"]*)"\),/);
				if ( !match || match.length < 3 )
					return;
				name = match[1];
				args = match[2];

				if ( funcNames.length > 0 )
					funcNames += "|";
				funcNames += escRegex(name);

				completionsTxt += "0\t" + name;

				if ( args.length > 0 ) {
					let completionsArgs = "";
					let completionsInsertText = name + "(";

					for ( let i = 0; i < args.length; i++ ) {
						let argType = args.charAt(i);
						if ( i != 0 ) {
							completionsArgs += ", ";
							completionsInsertText += ", ";
						}
						completionsArgs += argType + " arg" + (i+1);
	
						completionsInsertText += "${"+(i+1)+":"+argType+"_arg"+(i+1)+"}"
						
					}
					completionsInsertText += ")$0";

					completionsTxt += "\t" + completionsArgs + "\t" + completionsInsertText;
				}
				completionsTxt  += "\n";
			});
		}


		if ( !fs.existsSync(completionsTxtDir) )
			fs.mkdirSync(completionsTxtDir);
		
		fs.writeFileSync(completionsTxtFn, completionsTxt);

		// Write constant names to syntax file, for syntax highlighting
		let constNames = "";
		
		function fillConstNamesFromMap(map : Map<string, any>) {
			map.forEach((val, key) => {
				let nameEsc = escRegex(key);
				if ( constNames.length > 0 )
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
			if ( constNames.length > 0 )
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

function getKeyValueLineId(document : vscode.TextDocument, line : vscode.TextLine) : number | undefined {
	let lineText = line.text;
	let commentPos = lineText.indexOf("--");
	if ( commentPos != -1 )
		 lineText = lineText.substring(commentPos);
	lineText = lineText.trim();

	let match = lineText.match(/([^ \t=]*)[ \t]*=[ \t]*([0-9]*)/);	// NAME = VAL
	if ( match && match.length > 2 ) {
		let val = match[2];
		let iVal = parseInt(val);
		//console.log(val);
		return iVal;
	}

	if ( line.lineNumber + 1 >= document.lineCount )
		return undefined;

	return getKeyValueLineId(document, document.lineAt(line.lineNumber + 1));
}

function sortLuaKeyValTableInSelection() {
	let editor = vscode.window.activeTextEditor;
	if ( !editor )
		return;

	let document = editor.document;
	let selection = editor.selection;

	let startLine = selection.start.line;
	let endLine = selection.end.line;
	if ( selection.start.isEqual(selection.end) ) {
		startLine = 0;
		endLine = document.lineCount - 1;
	}

	let lines = new Array<vscode.TextLine>();

	for ( let l = startLine; l <= endLine; l++ )
		lines.push(document.lineAt(l));

		lines = lines.sort( (a, b) => {
		let aLineId = getKeyValueLineId(document, a);
		let bLineId = getKeyValueLineId(document, b);
		if ( aLineId !== undefined && bLineId !== undefined ) {
			if ( aLineId > bLineId )
				return 1;
			else if ( aLineId < bLineId )
				return -1;
		} 
		
		if ( a.lineNumber > b.lineNumber )
			return 1;
		else if ( b.lineNumber > a.lineNumber )
			return -1;
		else 
			return 0;
	});

	editor.edit(editBuilder => {
		let lineTexts = new Array<string>();
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
export function deactivate() {}
