const path = require('path');
const fs = require('fs-extra');
const parseSVGPath = require('parse-svg-path');
const parseXMLBasic = require('xml2js').parseString;
const parseXML = str => new Promise((resolve, reject) => parseXMLBasic(str, (err, res) => err ? reject(err) : resolve(res)));
const readXML = async f => await parseXML(await fs.readFile(f, 'utf8'));
const triangle = require('bindings')('triangle-node.node');

function arrayKeys(obj) { return Object.keys(obj).filter(k => Array.isArray(obj[k])) };
function searchObject(obj, key, excludeChildren) {
	let res = [];
	if(!excludeChildren) excludeChildren = [];
	if(obj[key]) res.push(obj[key]);
	let recRes = Object.keys(obj).filter(k => excludeChildren.indexOf(k) === -1 && typeof obj[k] === 'object').map(k => searchObject(obj[k], key, excludeChildren));
	while(recRes.find(Array.isArray))
		recRes = [].concat(...recRes);
	return res.concat(recRes);
}

// from https://stackoverflow.com/a/37716142
let binomials = [];
function binomial(n, k) {
	while(n >= binomials.length) {
		let s = binomials.length;
		binomials.push([...Array(s+1)].map((_, i) => i === 0 || i === s ? 1 : binomials[s-1][i-1] + binomials[s-1][i]));
	}
	return binomials[n][k];
}

// from https://en.wikipedia.org/wiki/Line%E2%80%93line_intersection
function lineLineIntersection(pt1, pt2, pt3, pt4) {
	let numInBounds = (bound1, bound2, check) => check >= Math.min(bound1, bound2) && check <= Math.max(bound1, bound2);
	let denom = (pt1[0]-pt2[0])*(pt3[1]-pt4[1]) - (pt1[1]-pt2[1])*(pt3[0]-pt4[0]);
	if(denom === 0) return;
	
	let op1 = pt1[0]*pt2[1] - pt1[1]*pt2[0];
	let op2 = pt3[0]*pt4[1] - pt3[1]*pt4[0];
	let numX = op1*(pt3[0]-pt4[0]) - (pt1[0]-pt2[0])*op2;
	let numY = op1*(pt3[1]-pt4[1]) - (pt1[1]-pt2[1])*op2;
	let x = numX/denom, y = numY/denom;
	
	if(numInBounds(pt1[0], pt2[0], x) && numInBounds(pt3[0], pt4[0], x) && numInBounds(pt1[1], pt2[1], y) && numInBounds(pt3[1], pt4[1], y))
		return [numX/denom, numY/denom];
}

function getAABB(points) {
	let fnPoints = fn => [0, 1].map(n => fn(...points.map(p => p[n])))
	let res = { min: fnPoints(Math.min), max: fnPoints(Math.max) };
	res.size = [0, 1].map(n => res.max[n] - res.min[n]);
	res.longSide = Math.max(...res.size);
	res.getPointInside = () => [0, 1].map(n => res.min[n] + Math.random()*res.size[n]);
	res.getPointOutside = margin => [0, 1].map(n => res.size[n]*(margin || 0.2)*(Math.random()*2-1)).map((n, i) => n>0 ? res.max[i]+n : res.min[i]+n);
	return res;
}

// from https://mathoverflow.net/a/56660
function findPointInPolygon(points) {
	let aabb = getAABB(points);
	let getEdgeMiddle = (a, b) => [0, 1].map(n => (a[n]+b[n]) / 2);
	let getRandomEdge = () => { let i = Math.floor(Math.random()*points.length); return [points[i], points[(i+1)%points.length]] };
	let pointDist = (a, b) => Math.sqrt(Math.pow(a[1] - b[1]) + Math.pow(a[0] - b[0]));
	
	while(true) {
		let P = aabb.getPointOutside();
		let M = getEdgeMiddle(...getRandomEdge());
		let intersectPoints = points.map((p, i) => lineLineIntersection(P, M, p, points[(i+1) % points.length])).filter(a => !!a);
		if(intersectPoints.find(a => !!points.map(p => pointDist(p, a)).find(d => d < 0.001)))
			continue;
		intersectPoints.sort((a, b) => pointDist(P, a) - pointDist(P, b));
		if(intersectPoints.length < 2)
			continue;
		return getEdgeMiddle(...intersectPoints);
	}
}

class SVGPath {
	constructor(d) {
		this.typesLong = ['moveto', 'closepath', 'lineto', 'horizontal_lineto', 'vertical_lineto', 'curveto', 'smooth_curveto', 'quadratic_bezier_curveto', 'smooth_quadratic_bezier_curveto', 'elliptical_arc'];
		this.typesShort = 'mzlhvcsqta';
		this.path = parseSVGPath(d);
	}

	chunk(arr, n) {
		return arr.reduce((prev, curr) => {
			prev[prev.length-1].push(curr);
			if(prev[prev.length-1].length === n) prev.push([]);
			return prev;
		}, [[]]).slice(0, -1);
	}

	evaluateBezier(P, numPoints) {
		let ret = [], degree = P.length - 1;
		for(let tIdx = 0; tIdx < numPoints; ++tIdx) {
			let t = 1.0 / (numPoints-1) * tIdx;
			let curr = [0, 0];
			for(let i = 0; i <= degree; i++) {
				let add = binomial(degree, i) * Math.pow(1 - t, degree-i) * Math.pow(t, i);
				curr = [curr[0] + add*P[i][0], curr[1] + add*P[i][1]];
			}
			ret.push(curr);
		}
		return ret;
	}

	verbosifySingle(e, i, doNotApply) {
		let additional, withCurr = true;
		let origPositioning = e[0].charCodeAt(0) >= 65 && e[0].charCodeAt(0) <= 90 ? 'absolute' : 'relative';
		let typeShortcut = (letter, pos) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) + (pos==='relative' ? 32 : 0));
		let reprocessChunked = (size, start, type) => {
			additional = this.chunk(e.slice(start || 1), size).map(p => verbosify([type || e[0], ...p], 0, true))
			withCurr = false;
		};
		
		let curr = {
			positioning: origPositioning,
			type: this.typesLong[this.typesShort.indexOf(e[0].toLowerCase())],
		};
		switch(curr.type) {
			case 'moveto': {
				curr.dest = [e[1], e[2]];
				if(i === 0) curr.positioning = 'absolute';
				reprocessChunked(2, 3, typeShortcut('l', origPositioning));
				withCurr = true;
				break;
			}
			case 'lineto': {
				if(e.length === 3) curr.dest = [e[1], e[2]];
				else reprocessChunked(2);
				break;
			}
			case 'curveto': {
				if(e.length === 7) {
					curr.controlBegin = [e[1], e[2]];
					curr.controlEnd = [e[3], e[4]];
					curr.dest = [e[5], e[6]];
				}
				else reprocessChunked(6);
				break;
			}
			case 'closepath': {
				delete curr.positioning;
				break;
			}
		}
		if(doNotApply)
			return [curr].concat(additional || []);
		else {
			if(withCurr) this.verbosePath.push(curr);
			if(additional) [].concat(...additional).forEach(a => this.verbosePath.push(a));
		}
	}

	verbosify() {
		this.verbosePath = [];
		this.path.map((e, i) => this.verbosifySingle(e, i));
		return this;
	}

	absolutify(ignoreFirstMoveTo) {
		if(!this.verbosePath) this.verbosify();
		let pos = [0, 0];
		
		this.verbosePath.filter(p => !!p.dest).forEach((p, i) => {
			if(p.positioning === 'absolute') {
				if(i === 0 && ignoreFirstMoveTo) p.dest = pos;
				else pos = p.dest;
			}
			else {
				arrayKeys(p).forEach(k => p[k] = p[k].map((x,i) => x+pos[i]));
				pos = p.dest;
				delete p.positioning;
			}
		});

		this.absolutified = true;
		return this;
	}

	segmentify(segmentsPerCurve) {
		if(!this.absolutified) this.absolutify(true);
		this.segmentedPath = [];
		let pos = [];

		this.verbosePath.forEach(p => {
			if(p.type !== 'curveto') {
				if(p.dest) pos = p.dest;
				this.segmentedPath.push(p);
				return;
			}

			this.segmentedPath = this.segmentedPath.concat([].concat(...this.evaluateBezier([pos, p.controlBegin, p.controlEnd, p.dest], segmentsPerCurve).map(p => this.verbosifySingle(['L', ...p], 0, true)).slice(1)));
			pos = p.dest;
		});

		this.segmentedPath.forEach(p => { if(p.dest) p.dest[1] = -p.dest[1]; });
		this.segmentified = true;
		return this;
	}

	boundify() {
		if(!this.segmentified) this.segmentify(5);

		let allPoints = [].concat(...this.segmentedPath.map(p => arrayKeys(p).map(k => p[k])));
		let aabb = getAABB(allPoints);

		this.segmentedPath.forEach(p => arrayKeys(p).forEach(k => {
			p[k] = p[k].map((v, i) => (v - aabb.min[i]) / aabb.longSide);
		}));
		
		this.boundified = true;
		return this;
	}

	findSubPaths() {
		if(!this.boundified) this.boundify();

		let idx;
		this.subPaths = [];
		while((idx = this.segmentedPath.findIndex(p => p.type === 'closepath')) !== -1) {
			if(idx === 0) continue;
			this.subPaths.push(this.segmentedPath.slice(0, idx).map(p => p.dest));
			this.segmentedPath = this.segmentedPath.slice(idx + 1);
		}
		this.holes = this.subPaths.slice(1).map(e => findPointInPolygon(e));
		this.subPaths.forEach(p => {
			if(p[0][0] === p[p.length-1][0] && p[0][1] === p[p.length-1][1])
				p.pop();
		})

		this.foundSubPaths = true;
		return this;
	}

	createPOLYFile() {
		if(!this.foundSubPaths) this.findSubPaths();
		let holesStr = this.holes.map((h, i) => [i, ...h].join(' ')).join('\n');
		
		let total = 0;
		let vertices = [].concat(...this.subPaths.map(sp => {
			let res = sp.map((p, i) => [total + i, ...p].join(' '));
			total += sp.length;
			return res;
		})).join('\n');

		total = 0;
		let segments = [].concat(...this.subPaths.map(sp => {
			let res = [...Array(sp.length)].map((_, i) => [total + i, total + i, total + (i+1) % sp.length].join(' '));
			total += sp.length;
			return res;
		})).join('\n');

		return `${total} 2 0 0\n${vertices}\n${total} 0\n${segments}\n${this.holes.length}\n${holesStr}\n`;
	}

	triangulate() {
		if(!this.foundSubPaths) this.findSubPaths();

		let total = 0;
		let pointlist = [].concat(...this.subPaths.map(sp => (total += sp.length, [].concat(...sp))));
		let segmentlist = (total = 0, [].concat(...this.subPaths.map(sp => {
			let res = [].concat(...[...Array(sp.length)].map((_, i) => [total+i, total+(i+1)%sp.length]));
			total += sp.length;
			return res;
		})));
		let res = triangle.triangulate({
			pointlist,
			segmentlist,
			holelist: [].concat(...this.holes),
		});

		res = res.trianglelist.map(tri => tri.map(ptIdx => [res.pointlist[ptIdx*2], res.pointlist[ptIdx*2+1], 0]))
		let vertices = [].concat(...res.map(a => [].concat(...a)));
		return { vertices };
	}
}

(async () => {
	if(process.argv.length < 3) {
		console.info(`usage: ${process.argv.map(e => path.basename(e)).join(' ')} [file]`);
		return;
	}

	let svg = await readXML(process.argv[2]);
	let paths = searchObject(svg, 'path', ['$']).map(e => e.$), desiredPath;
	if(paths.length === 0) {
		console.error('no paths found in input file');
		return;
	}
	else if(paths.length > 1) {
		if(process.argv.length < 4) {
			console.error('input file has multiple paths, please specify the desired id as an additional parameter');
			return;
		}
		desiredPath = paths.find(p => p.id === process.argv[3]);
		if(!desiredPath) {
			console.error(`input file has no path with id '${process.argv[3]}`);
			return;
		}
	}
	else {
		desiredPath = paths[0];
	}

	desiredPath = new SVGPath(desiredPath.d).boundify();
	console.log(JSON.stringify(desiredPath.triangulate()));
})();
