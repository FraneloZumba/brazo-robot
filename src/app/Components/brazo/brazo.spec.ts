import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Brazo } from './brazo';

describe('Brazo', () => {
  let component: Brazo;
  let fixture: ComponentFixture<Brazo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Brazo],
    }).compileComponents();

    fixture = TestBed.createComponent(Brazo);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
