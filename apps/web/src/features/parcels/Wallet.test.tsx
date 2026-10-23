// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Wallet} from './Wallet';
import {api} from '../../api';
vi.mock('../../api',()=>({api:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const base={totalPaise:500,lockedPaise:500,availablePaise:0,providerConnected:false,account:null,earnings:[],withdrawals:[]};
it('disables simulated withdrawal while credits remain locked',async()=>{
 vi.mocked(api).mockResolvedValue(base);render(<Wallet/>);
 expect((await screen.findByRole('button',{name:/Simulate withdrawal/}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText(/No real funds are held or sent/)).toBeTruthy();
});
it('explicitly requests simulation and refreshes the saved receipt',async()=>{
 const mock=vi.mocked(api);mock.mockResolvedValueOnce({...base,lockedPaise:0,availablePaise:500}).mockResolvedValueOnce({message:'Simulation receipt saved'}).mockResolvedValueOnce({...base,lockedPaise:0,withdrawals:[{id:'receipt-123',amountPaise:500,status:'SIMULATED',createdAt:'2026-10-24T00:00:00Z'}]});
 render(<Wallet/>);fireEvent.click(await screen.findByRole('button',{name:/Simulate withdrawal/}));
 await waitFor(()=>expect(mock).toHaveBeenCalledWith('/workspace/wallet/withdraw',{method:'POST',body:JSON.stringify({simulate:true})}));
 expect(await screen.findByText(/Ref eipt-123/)).toBeTruthy();
});
