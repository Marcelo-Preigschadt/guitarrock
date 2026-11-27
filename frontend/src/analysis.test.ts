import { describe, expect, it } from "vitest";
import { mergeAnalysis } from "./analysis";
import { makeTrack } from "./types";
import type { Job, Project } from "./types";

const project: Project = {
  version:1,id:"session",title:"Any song",filename:"any.mp3",duration:240,updated:1,
  jobId:"job",jobResultId:"job",jobApplied:true,analysisPending:true,
  tracks:[{...makeTrack("guitar","job-guitar"),loadState:"ready",volume:.4,solo:true}],cues:[],rawText:"",
};
const job: Job = {
  id:"job",status:"completed",stage:"Faixas prontas",progress:100,warnings:[],analysis_state:"ready",
  result:{duration:240,analysis_revision:"revision",bpm:120,chords:[{start:0,end:2,label:"Em"}],
    tracks:[{id:"guitar",kind:"guitar",name:"Guitarra",file:"guitar.wav",notes:[{start:0,end:1,pitch:64,velocity:.8}]}]},
};

describe("entrega posterior de cifras e notas",()=>{
  it("aplica o arranjo sem trocar IDs, volumes, áudio carregado ou estado de entrega",()=>{
    const result=mergeAnalysis(project,job);
    expect(result.jobApplied).toBe(true);expect(result.analysisPending).toBe(false);
    expect(result.tracks[0]).toMatchObject({id:"job-guitar",volume:.4,solo:true,loadState:"ready"});
    expect(result.tracks[0].notes?.[0].pitch).toBe(64);expect(result.harmony?.[0].label).toBe("Em");
    const edited={...result,harmony:[{start:0,end:2,label:"Am"}]};
    expect(mergeAnalysis(edited,job).harmony?.[0].label).toBe("Am");
  });
  it("preserva correções de notas e texto importado enquanto a IA terminava",()=>{
    const edited={...project,tracks:[{...project.tracks[0],notesEdited:true,notes:[{start:0,end:1,pitch:67,velocity:.9}]}],
      cues:[{id:"manual",source:"manual" as const,text:"Am",start:0}],timingEdited:true,bpm:100};
    const result=mergeAnalysis(edited,job);
    expect(result.tracks[0].notes?.[0].pitch).toBe(67);expect(result.cues).toEqual(edited.cues);
    expect(result.bpm).toBe(100);
    expect(mergeAnalysis({...project,jobId:"other"},job)).toMatchObject({analysisPending:true});
  });
  it("continua aguardando depois de baixar as faixas e permite terminar sem letra",()=>{
    expect(mergeAnalysis(project,{...job,analysis_state:"running"}).analysisPending).toBe(true);
    expect(mergeAnalysis(project,{...job,analysis_state:"cancelled"}).analysisPending).toBe(false);
  });
});
