#include <cstdlib>
#include <cstring>
#include <iostream>

#define ANSI_DECLARATORS
#define VOID void
#ifdef SINGLE
#define REAL float
#else
#define REAL double
#endif

extern "C" {
	#include <triangle.h>
}
#include <napi.h>

template<typename T>
void ArrayToMemory(const Napi::Array& arr, T** arrDest, int* lenDest) {
	uint32_t len = arr.Length();
	*arrDest = (T*)malloc(len * sizeof(T));
	for(uint32_t i = 0; i < len; ++i)
		(*arrDest)[i] = (T)arr.Get(i).As<Napi::Number>();
	*lenDest = len / 2;
}

template<typename T>
Napi::Array MemoryToArray(const Napi::Env& env, T* data, uint32_t len) {
	Napi::Array ret = Napi::Array::New(env, len);
	for(uint32_t i = 0; i < len; ++i)
		ret.Set(i, data[i]);
	return ret;
}


template<typename T>
Napi::Array MemoryToChunkedArray(const Napi::Env& env, T* data, uint32_t len, uint32_t chunk) {
	Napi::Array ret = Napi::Array::New(env, len);
	for(uint32_t i = 0; i < len; ++i) {
		Napi::Array curr = Napi::Array::New(env, chunk);
		for(uint32_t j = 0; j < chunk; ++j) {
			curr.Set(j, data[i*chunk + j]);
		}
		ret.Set(i, MemoryToArray<T>(env, data + i*chunk, chunk));
	}
	return ret;
}

void freeTriData(struct triangulateio* in, struct triangulateio* out) {
	free(in->pointlist);
	free(in->pointattributelist);
	free(in->pointmarkerlist);
	free(in->regionlist);
	free(out->pointlist);
	free(out->pointattributelist);
	free(out->trianglelist);
	free(out->triangleattributelist);
}

Napi::Object Triangulate(const Napi::CallbackInfo& info) {
	// check for correct number and types of parameters
	Napi::Env env = info.Env();
	if(info.Length() < 1 || !info[0].IsObject())
		Napi::TypeError::New(env, "object expected").ThrowAsJavaScriptException();
	
	// initialize input and output structures
	struct triangulateio triInput;
	struct triangulateio triOutput;
	memset(&triInput, 0, sizeof(triInput));
	memset(&triOutput, 0, sizeof(triOutput));
	
	// fill input structure with provided data
	Napi::Object params = info[0].As<Napi::Object>();
	ArrayToMemory<REAL>(params.Get("pointlist").As<Napi::Array>(), &triInput.pointlist, &triInput.numberofpoints);
	ArrayToMemory<int>(params.Get("segmentlist").As<Napi::Array>(), &triInput.segmentlist, &triInput.numberofsegments);
	ArrayToMemory<REAL>(params.Get("holelist").As<Napi::Array>(), &triInput.holelist, &triInput.numberofholes);
	
	// run triangulation
	triangulate((char*)"pzQ", &triInput, &triOutput, nullptr);

	// return triangle data as an array (TODO: free memory)
	Napi::Object ret = Napi::Object::New(env);
	ret.Set("pointlist", MemoryToArray<REAL>(env, triOutput.pointlist, triOutput.numberofpoints*2));
	ret.Set("trianglelist", MemoryToChunkedArray<int>(env, triOutput.trianglelist, triOutput.numberoftriangles, triOutput.numberofcorners));
	freeTriData(&triInput, &triOutput);
	return ret;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	exports.Set("triangulate", Napi::Function::New(env, Triangulate));
	return exports;
}

NODE_API_MODULE(addon, Init);
